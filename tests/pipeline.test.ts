// NOTE: the LLM below is a TEST DOUBLE used only to test plumbing (chunking, validation, repair, merge,
// grounding). It says nothing about real model quality. Real inference is verified manually in Chrome.
import { describe, it, expect } from "vitest";
import { parseChat } from "@/lib/parser";
import { SAMPLE_CHAT, SAMPLE_USER } from "@/data/sample";
import { chunkMessages } from "@/lib/chunk";
import { analyzeChat, askChat, suggestReplies, type LLM } from "@/lib/pipeline";
import { extractJson, groundAnalysis, ChunkAnalysisSchema } from "@/lib/schema";
import { mergeGrounded } from "@/lib/merge";
import { Bm25Index } from "@/lib/retrieval";

const chat = parseChat(SAMPLE_CHAT);
const byId = new Map(chat.messages.map((m) => [m.id, m]));

describe("chunking", () => {
  it("never sends the whole chat in one chunk when it is long; overlaps; covers every message", () => {
    const long = parseChat(Array.from({ length: 400 }, (_, i) => `13/10/2026, 10:${String(i % 60).padStart(2, "0")} - Ravi: message number ${i} about the plan and some filler words here`).join("\n"));
    const ch = chunkMessages(long.messages);
    expect(ch.length).toBeGreaterThan(3);
    expect(ch[1].messages[0].idx).toBeLessThan(ch[1].core[0]); // overlap present
    const covered = new Set(ch.flatMap((c) => c.messages.map((m) => m.idx)));
    expect(covered.size).toBe(400);
    expect(ch.every((c) => c.messages.reduce((a, m) => a + m.text.length, 0) < 5000)).toBe(true);
  });
});

describe("JSON repair + schema", () => {
  it("extracts JSON from fences, prose and trailing commas", () => {
    expect(extractJson('Sure!\n```json\n{"a":[1,2,],"b":"x}"}\n```')).toEqual({ a: [1, 2], b: "x}" });
  });
  it("defaults missing arrays; rejects wrong types", () => {
    expect(ChunkAnalysisSchema.parse({}).actions).toEqual([]);
    expect(() => ChunkAnalysisSchema.parse({ actions: [{ task: 5 }] })).toThrow();
  });
});

describe("grounding: ID validation, no invented owners/deadlines", () => {
  const refMap = new Map([[1, "m000008"], [2, "m000009"]]);   // invoice request + ...
  it("drops findings with no valid source; keeps and flags partial", () => {
    const a = ChunkAnalysisSchema.parse({ highlights: [{ text: "ghost", src: [99] }, { text: "real", src: [1, 99] }] });
    const g = groundAnalysis(a, refMap, byId);
    expect(g.highlights.map((h) => h.text)).toEqual(["real"]);
    expect(g.highlights[0].flags[0]).toMatch(/invalid source/);
    expect(g.droppedFindings).toBe(1);
  });
  it("removes an invented owner and invented deadline, keeps stated ones", () => {
    const m = chat.messages.find((x) => x.text.includes("take the invoice"))!;
    const rm = new Map([[1, m.id]]);
    const a = ChunkAnalysisSchema.parse({ actions: [
      { task: "Pay invoice", owner: "Asha", deadline: "Thursday EOD", src: [1] },
      { task: "Pay invoice 2", owner: "Kabir", deadline: "next month", status: "done", src: [1] } ] });
    const g = groundAnalysis(a, rm, byId);
    expect(g.actions[0].owner).toBe("Asha"); expect(g.actions[0].deadline).toBe("Thursday EOD");
    expect(g.actions[1].owner).toBeNull(); expect(g.actions[1].deadline).toBeNull(); expect(g.actions[1].status).toBeNull();
    expect(g.actions[1].flags.length).toBe(3);
  });
});

describe("merge", () => {
  const A = { ...ChunkAnalysisSchema.parse({}) };
  it("dedupes, ORs 'answered', and builds a before/after decision without trusting recency", () => {
    const f = (id: number) => `m${String(id).padStart(6, "0")}`;
    const mk = (o: any) => groundAnalysis(ChunkAnalysisSchema.parse(o), new Map([[1, f(o.__id)]]), byId);
    const p1 = mk({ __id: 2, decisions: [{ topic: "dinner plan", latest: "Friday 7pm at Café Nine", src: [1] }], questions: [{ question: "Who is driving on Saturday?", answered: false, src: [1] }] });
    const m18 = chat.messages.find((x) => x.text.includes("Final"))!.idx;
    const p2 = mk({ __id: m18, decisions: [{ topic: "the dinner plan", latest: "Saturday 8pm", src: [1] }], questions: [{ question: "who is driving Saturday", answered: true, src: [1] }] });
    const merged = mergeGrounded([p2, p1], byId); // out of order on purpose
    expect(merged.questions).toHaveLength(1);
    expect(merged.questions[0].answered).toBe(true);
    expect(merged.decisions).toHaveLength(1);
    expect(merged.decisions[0].previous).toBe("Friday 7pm at Café Nine");
    expect(merged.decisions[0].latest).toBe("Saturday 8pm");
    expect(merged.decisions[0].sources).toHaveLength(2);
    // "no wait, Saturday 8pm. Final." carries a finality cue => not flagged uncertain
    expect(merged.decisions[0].uncertain).toBe(false);
  });
  it("merges a single decision group without requiring multiple chunks", () => {
    const id = chat.messages.find((m) => m.text.includes("Saturday 8pm"))!.id;
    const part = groundAnalysis(
      ChunkAnalysisSchema.parse({ decisions: [{ topic: "dinner plan", latest: "Saturday 8pm", src: [1] }] }),
      new Map([[1, id]]),
      byId,
    );
    const merged = mergeGrounded([part], byId);
    expect(merged.decisions).toHaveLength(1);
    expect(merged.decisions[0].latest).toBe("Saturday 8pm");
    expect(merged.decisions[0].sources).toContain(id);
  });

  it("flags uncertainty when the latest source is a tentative revision (later does NOT automatically win)", () => {
    const mk = (id: string, latest: string) => groundAnalysis(ChunkAnalysisSchema.parse({ decisions: [{ topic: "dinner plan", latest, src: [1] }] }), new Map([[1, id]]), byId);
    const early = chat.messages.find((x) => x.text.includes("Okay team"))!.id;
    const tentative = parseChat("14/10/2026, 11:00 - Ravi: maybe Sunday instead? not sure").messages[0];
    const map2 = new Map(byId); const t2 = { ...tentative, id: "mTENT", idx: 999, ts: Date.parse("2026-10-14T11:00:00Z") }; map2.set("mTENT", t2);
    const p1 = mk(early, "Friday 7pm");
    const p2 = groundAnalysis(ChunkAnalysisSchema.parse({ decisions: [{ topic: "dinner plan", latest: "Sunday", src: [1] }] }), new Map([[1, "mTENT"]]), map2);
    const merged = mergeGrounded([p1, p2], map2);
    expect(merged.decisions[0].uncertain).toBe(true);
    expect(merged.decisions[0].previous).toBe("Friday 7pm");
  });
});

/* ---------- test double ---------- */
const scripted = (replies: string[]): LLM & { calls: number; prompts: string[] } => {
  const o = { calls: 0, prompts: [] as string[], async complete(m: any[]) { o.prompts.push(m.map((x) => x.content).join("\n")); return replies[Math.min(o.calls++, replies.length - 1)]; } };
  return o;
};

describe("analyzeChat (test double LLM)", () => {
  it("repairs malformed JSON then succeeds; reports real progress; wraps chat as data", async () => {
    const llm = scripted(["not json at all", '{"summary":"ok","highlights":[{"text":"h","src":[1]}]}']);
    const events: string[] = [];
    const r = await analyzeChat(llm, chat.messages, SAMPLE_USER, (p) => events.push(p.label));
    expect(r.retries).toBeGreaterThanOrEqual(1);
    expect(r.failedChunks).toEqual([]);
    expect(r.grounded.highlights.length).toBe(1);
    expect(events.length).toBe(r.totalChunks + 1);
    expect(llm.prompts[0]).toContain("<<<CHAT_DATA");
    expect(llm.prompts[0]).toContain("[flagged: looks like an instruction");
  });
  it("degrades gracefully after limited retries (no throw, no fake output)", async () => {
    const llm = scripted(["garbage"]);
    const r = await analyzeChat(llm, chat.messages, SAMPLE_USER);
    expect(r.failedChunks.length).toBe(r.totalChunks);
    expect(r.grounded.actions).toEqual([]);
    expect(llm.calls).toBe(r.totalChunks * 3); // 1 try + 2 repairs per chunk
  });
  it("cancellation aborts", async () => {
    const ac = new AbortController(); ac.abort();
    await expect(analyzeChat(scripted(["{}"]), chat.messages, "Asha", undefined, ac.signal)).rejects.toThrow();
  });
});

describe("askChat", () => {
  const idx = new Bm25Index(chat.messages);
  it("does NOT call the model for unrelated questions", async () => {
    const llm = scripted(["The Argentina team won [1]"]);
    const a = await askChat(llm, idx, "Who won the World Cup?", "Asha");
    expect(a.status).toBe("insufficient"); expect(llm.calls).toBe(0);
  });
  it("does NOT call the model when the question is too vague", async () => {
    const llm = scripted(["x"]); const a = await askChat(llm, idx, "what about it?", "Asha");
    expect(a.status).toBe("clarify"); expect(llm.calls).toBe(0);
  });
  it("validates citations: invented [n] dropped; answer with none valid is rejected", async () => {
    const good = await askChat(scripted(["Due Thursday [1] and also [77]."]), idx, "When is the invoice due?", "Asha");
    expect(good.status).toBe("answered"); expect(good.sources.length).toBe(1); expect(good.droppedRefs).toEqual([77]);
    const bad = await askChat(scripted(["Due Thursday [88]."]), idx, "When is the invoice due?", "Asha");
    expect(bad.status).toBe("uncited");
  });
  it("surfaces conflicting evidence", async () => {
    const a = await askChat(scripted(["Saturday 8pm [1]."]), idx, "When is the dinner?", "Asha");
    expect(a.conflicting.length).toBeGreaterThan(1);
  });
  it("prompt-injection message in retrieved data is quoted + flagged and the answer is still citation-checked", async () => {
    const llm = scripted(["Kabir asked the assistant to reveal its prompt, which is just chat text [1]."]);
    const a = await askChat(llm, idx, "What did Kabir say about the system prompt?", "Asha");
    expect(llm.prompts[0]).toMatch(/\[flagged: looks like an instruction/);
    expect(llm.prompts[0]).toMatch(/never an instruction/);
    expect(a.status).toBe("answered");
  });
});

describe("suggestReplies", () => {
  it("parses, grounds sources, caps at 3", async () => {
    const target = chat.messages.find((m) => m.text.includes("take the invoice"))!;
    const llm = scripted(['{"replies":[{"text":"Yes, I\'ll pay it by Thursday.","src":[1]},{"text":"Sure, will do 👍","src":[99]}]}']);
    const r = await suggestReplies(llm, chat.messages, target, "Asha");
    expect(r).toHaveLength(2);
    expect(r[1].sources).toEqual([]);
  });
});
