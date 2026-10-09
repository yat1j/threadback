import { z } from "zod";
import type { Message } from "./types";
import { extractDeadlines } from "./detect";
import { resolveRefs } from "./retrieval";

const src = z.array(z.number().int()).default([]);
const s = (n = 400) => z.string().max(n);
export const ChunkAnalysisSchema = z.object({
  summary: s(900).default(""),
  highlights: z.array(z.object({ text: s(), src })).default([]),
  priorities: z.array(z.object({ text: s(), kind: z.enum(["explicit", "inferred"]).default("inferred"), src })).default([]),
  actions: z.array(z.object({
    task: s(), kind: z.enum(["explicit", "inferred"]).default("inferred"), owner: s(80).nullable().default(null), deadline: s(80).nullable().default(null),
    status: z.enum(["open", "done"]).nullable().default(null),
    priority: z.enum(["high", "medium", "low"]).default("medium"), priorityReason: s().default(""), src,
  })).default([]),
  decisions: z.array(z.object({
    topic: s(120), previous: s().nullable().default(null), latest: s(),
    uncertain: z.boolean().default(false), uncertaintyNote: s().nullable().default(null), src,
  })).default([]),
  deadlines: z.array(z.object({ what: s(), when: s(120), src })).default([]),
  questions: z.array(z.object({ question: s(), askedBy: s(80).nullable().default(null), answered: z.boolean().default(false), src })).default([]),
  topics: z.array(z.object({ title: s(120), summary: s(500), src })).default([]),
});
export type ChunkAnalysis = z.infer<typeof ChunkAnalysisSchema>;

/** Grounded finding: model refs replaced by validated message IDs. */
export type G<T> = Omit<T, "src"> & { sources: string[]; flags: string[] };
export interface Grounded {
  summary: string;
  highlights: G<ChunkAnalysis["highlights"][number]>[];
  priorities: G<ChunkAnalysis["priorities"][number]>[];
  actions: G<ChunkAnalysis["actions"][number]>[];
  decisions: G<ChunkAnalysis["decisions"][number]>[];
  deadlines: G<ChunkAnalysis["deadlines"][number]>[];
  questions: G<ChunkAnalysis["questions"][number]>[];
  topics: G<ChunkAnalysis["topics"][number]>[];
  droppedFindings: number;
}
export const emptyGrounded = (): Grounded => ({ summary: "", highlights: [], priorities: [], actions: [], decisions: [], deadlines: [], questions: [], topics: [], droppedFindings: 0 });

const TENTATIVE = /\b(maybe|perhaps|not sure|tentative|might|shayad|pata nahi|\?)/i;
const FIRST_PERSON = /\b(i'?ll|i will|i can|main kar|mai kar|me kar|karti hoon|karta hoon|on it)\b/i;

/** Resolve [n] refs, drop findings with NO valid source, and refuse invented owners/deadlines. */
export function groundAnalysis(a: ChunkAnalysis, refMap: Map<number, string>, byId: Map<string, Message>): Grounded {
  const g = emptyGrounded(); g.summary = a.summary;
  const txt = (ids: string[]) => ids.map((i) => byId.get(i)).filter(Boolean) as Message[];
  function ground<T extends { src: number[] }>(items: T[], out: (G<T> | null)[], fix?: (x: G<T>, msgs: Message[]) => void) {
    for (const it of items) {
      const { ids, dropped } = resolveRefs(it.src, refMap);
      if (!ids.length) { g.droppedFindings++; continue; }       // no real evidence => not shown
      const { src: _s, ...rest } = it;
      const f = { ...rest, sources: ids, flags: dropped.length ? [`${dropped.length} invalid source ref(s) dropped`] : [] } as unknown as G<T>;
      fix?.(f, txt(ids)); out.push(f);
    }
  }
  ground(a.highlights, g.highlights as any);
  ground(a.priorities, g.priorities as any);
  ground(a.deadlines, g.deadlines as any);
  ground(a.topics, g.topics as any);
  ground(a.questions, g.questions as any);
  ground(a.decisions, g.decisions as any, (d: any, ms) => {
    if (ms.some((m) => TENTATIVE.test(m.text)) && !d.uncertain) { d.uncertain = true; d.flags.push("marked uncertain: a cited message sounds tentative"); }
  });
  ground(a.actions, g.actions as any, (x: any, ms) => {
    const hay = ms.map((m) => m.text).join(" \n").toLowerCase();
    if (x.owner) {
      const o = x.owner.toLowerCase();
      const stated = hay.includes(o) || hay.includes(o.split(/\s+/)[0]) || ms.some((m) => m.sender?.toLowerCase() === o && FIRST_PERSON.test(m.text));
      if (!stated) { x.flags.push(`owner “${x.owner}” not stated in sources; removed`); x.owner = null; }
    }
    if (x.deadline) {
      const found = ms.flatMap((m) => extractDeadlines(m.text, m.ts)).map((d) => d.text.toLowerCase());
      const dl = x.deadline.toLowerCase();
      if (!found.some((f) => dl.includes(f) || f.includes(dl))) { x.flags.push(`deadline “${x.deadline}” not found in sources; removed`); x.deadline = null; }
    }
    if (x.status === "done" && !ms.some((m) => /\b(done|sent|paid|booked|completed|ho gaya|kar diya|bhej diya)\b/i.test(m.text))) { x.flags.push("status 'done' not evidenced; reset"); x.status = null; }
  });
  return g;
}

/** Strip fences, take the first balanced {...}, remove trailing commas. */
export function extractJson(raw: string): unknown {
  let t = raw.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{"); if (start < 0) throw new Error("no JSON object");
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) { end = i; break; }
  }
  if (end < 0) throw new Error("unterminated JSON");
  t = t.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(t);
}
