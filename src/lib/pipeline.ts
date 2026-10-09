import type { Message } from "./types";
import { chunkMessages } from "./chunk";
import { quoteMessages, analysisPrompt, answerPrompt, repliesPrompt } from "./prompt";
import { ChunkAnalysisSchema, extractJson, groundAnalysis, emptyGrounded, type Grounded } from "./schema";
import { mergeGrounded } from "./merge";
import { Bm25Index, retrieve, extractCitations, INSUFFICIENT } from "./retrieval";
import { z } from "zod";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
export interface LLM { complete(messages: ChatMsg[], opts?: { maxTokens?: number; json?: boolean; signal?: AbortSignal }): Promise<string> }

export interface ProgressEvent { step: "chunk" | "merge" | "done"; done: number; total: number; label: string }
export interface AnalysisResult { grounded: Grounded; failedChunks: number[]; totalChunks: number; retries: number }

async function structured<T>(llm: LLM, msgs: ChatMsg[], schema: z.ZodType<T>, signal?: AbortSignal, maxRepairs = 2) {
  let last = "", retries = 0, convo = msgs;
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    last = await llm.complete(convo, { maxTokens: 900, json: true, signal });
    try { return { value: schema.parse(extractJson(last)), retries }; }
    catch (e) {
      retries++;
      convo = [...msgs, { role: "assistant", content: last.slice(0, 1500) }, { role: "user", content: "That was not valid JSON for the required shape. Reply again with ONLY the corrected JSON object." }];
    }
  }
  return { value: null as T | null, retries };
}

export async function analyzeChat(llm: LLM, msgs: Message[], user: string, onProgress?: (p: ProgressEvent) => void, signal?: AbortSignal): Promise<AnalysisResult> {
  const chunks = chunkMessages(msgs);
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const parts: Grounded[] = []; const failed: number[] = []; let retries = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const q = quoteMessages(chunks[i].messages);
    const r = await structured(llm, analysisPrompt(q, user, i, chunks.length), ChunkAnalysisSchema, signal);
    retries += r.retries;
    if (r.value) parts.push(groundAnalysis(r.value, q.refMap, byId)); else { failed.push(i); parts.push(emptyGrounded()); }
    onProgress?.({ step: "chunk", done: i + 1, total: chunks.length, label: `Analysed part ${i + 1} of ${chunks.length}` });
  }
  const grounded = mergeGrounded(parts, byId);
  onProgress?.({ step: "done", done: chunks.length, total: chunks.length, label: "Merged and validated sources" });
  return { grounded, failedChunks: failed, totalChunks: chunks.length, retries };
}

export interface Answer { text: string; sources: string[]; droppedRefs: number[]; status: "answered" | "insufficient" | "clarify" | "uncited"; conflicting: string[] }
/** Retrieval first. The model is NEVER called unless evidence passes the threshold. */
export async function askChat(llm: LLM, index: Bm25Index, question: string, user: string, signal?: AbortSignal): Promise<Answer> {
  const ev = retrieve(index, question);
  if (ev.status === "clarify") return { text: ev.message, sources: [], droppedRefs: [], status: "clarify", conflicting: [] };
  if (ev.status === "insufficient") return { text: INSUFFICIENT, sources: [], droppedRefs: [], status: "insufficient", conflicting: [] };
  const hits = [...ev.hits].sort((a, b) => a.msg.idx - b.msg.idx).map((h) => h.msg);
  const q = quoteMessages(hits);
  const text = (await llm.complete(answerPrompt(question, q, user), { maxTokens: 300, signal })).trim();
  const { ids, droppedRefs } = extractCitations(text, q.refMap);
  if (/couldn'?t find enough evidence/i.test(text)) return { text: INSUFFICIENT, sources: [], droppedRefs, status: "insufficient", conflicting: [] };
  // an answer with no valid citation is not allowed to look authoritative
  if (!ids.length) return { text: INSUFFICIENT, sources: [], droppedRefs, status: "uncited", conflicting: [] };
  return { text, sources: ids, droppedRefs, status: "answered", conflicting: ev.conflicting };
}

const RepliesSchema = z.object({ replies: z.array(z.object({ text: z.string().max(240), src: z.array(z.number().int()).default([]) })).max(3) });
export async function suggestReplies(llm: LLM, all: Message[], target: Message, user: string, signal?: AbortSignal) {
  const ctx = all.slice(Math.max(0, target.idx - 6), target.idx + 4).filter((m) => !m.system);
  const q = quoteMessages(ctx);
  const r = await structured(llm, repliesPrompt(target, q, user), RepliesSchema, signal);
  if (!r.value) return [];
  return r.value.replies.map((x) => ({ text: x.text, sources: [...new Set(x.src.map((n) => q.refMap.get(n)).filter(Boolean) as string[])] })).filter((x) => x.text.trim());
}
