import type { Message } from "./types";
import { extractDeadlines } from "./detect";

const STOP = new Set(("a an the is are was were be been am do does did of to in on at for with and or but if so it its this that these those i you he she we they me my your our their " +
  "what who whom when where which why how about from by as any there here can could would should will shall has have had not no yes tell me please " +
  "hai hain ho kya ka ki ke ko se me mein par aur ya toh to bhi nahi").split(" "));
const QWORDS = new Set(["what", "who", "when", "where", "which", "why", "how", "kya", "kab", "kaun", "kahan", "kyun"]);

// Small, honest synonym map: lets "event" find "dinner". Extend as needed.
const EXPAND: Record<string, string[]> = {
  event: ["dinner", "party", "plan", "meeting", "gathering"],
  venue: ["cafe", "café", "restaurant", "booking", "table", "nine"],
  deadline: ["due", "by", "tak", "till"],
  form: ["registration", "form"],
  invoice: ["paid", "caterer", "payment"],
  time: ["pm", "am", "7pm", "8pm"],
  car: ["drive", "driving", "driver"],
};

export function tokenize(s: string): string[] {
  return (s.toLowerCase().normalize("NFC").match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).map(stem);
}
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export interface Hit { msg: Message; score: number; matched: string[] }
export class Bm25Index {
  private docs: { msg: Message; tf: Map<string, number>; len: number }[] = [];
  private df = new Map<string, number>();
  private avg = 1;
  constructor(msgs: Message[]) {
    for (const m of msgs) {
      if (m.system || m.media) continue;
      const toks = tokenize(m.text + " " + (m.sender ?? ""));
      const tf = new Map<string, number>();
      toks.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      this.docs.push({ msg: m, tf, len: toks.length || 1 });
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avg = this.docs.reduce((a, d) => a + d.len, 0) / (this.docs.length || 1);
  }
  search(terms: string[], limit = 8, k1 = 1.4, b = 0.75): Hit[] {
    const N = this.docs.length;
    const hits: Hit[] = [];
    for (const d of this.docs) {
      let s = 0; const matched: string[] = [];
      for (const t of terms) {
        const f = d.tf.get(t); if (!f) continue;
        const n = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avg)));
        matched.push(t);
      }
      if (s > 0) hits.push({ msg: d.msg, score: s, matched });
    }
    return hits.sort((a, b2) => b2.score - a.score || a.msg.idx - b2.msg.idx).slice(0, limit);
  }
}

export interface TermGroup { term: string; alts: string[] }
/** One group per content word; synonyms belong to THEIR word's group, so they can only help that word. */
export function queryTerms(q: string): { core: string[]; groups: TermGroup[] } {
  const raw = (q.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).filter((w) => !STOP.has(w) && !QWORDS.has(w));
  const groups = raw.map((w) => ({ term: stem(w), alts: (EXPAND[w] ?? []).map(stem) }));
  return { core: groups.map((g) => g.term), groups };
}

export type Evidence =
  | { status: "ok"; hits: Hit[]; coverage: number; conflicting: string[] }
  | { status: "insufficient"; message: string; coverage: number }
  | { status: "clarify"; message: string };

export const INSUFFICIENT = "I couldn't find enough evidence in this chat.";

/** Retrieval + evidence threshold. The model is only called when status === "ok". */
export function retrieve(index: Bm25Index, question: string, opts: { limit?: number; minScore?: number; minCoverage?: number } = {}): Evidence {
  const { groups } = queryTerms(question);
  if (groups.length === 0)
    return { status: "clarify", message: "Could you be more specific? For example, mention a person, topic or date from the chat." };
  const terms = [...new Set(groups.flatMap((g) => [g.term, ...g.alts]))];
  const hits = index.search(terms, opts.limit ?? 8);
  const matchedAll = new Set(hits.flatMap((h) => h.matched));
  const covered = groups.filter((g) => matchedAll.has(g.term) || g.alts.some((a) => matchedAll.has(a))).length;
  const coverage = covered / groups.length;
  const ok = hits.length > 0 && hits[0].score >= (opts.minScore ?? 1) && coverage >= (opts.minCoverage ?? 0.5);
  if (!ok) return { status: "insufficient", message: INSUFFICIENT, coverage };
  const phrases = new Set<string>();
  for (const h of hits) for (const d of extractDeadlines(h.msg.text, h.msg.ts)) if (d.kind === "weekday" || d.kind === "time") phrases.add(d.text.toLowerCase());
  const conflicting = phrases.size > 1 ? [...phrases] : [];
  return { status: "ok", hits, coverage, conflicting };
}

/** Restrict retrieval to a message-id window ("Ask this moment"). */
export function indexFor(msgs: Message[]): Bm25Index { return new Bm25Index(msgs); }

/* ---------------- source ID validation ---------------- */
export function validateIds(ids: string[], known: Set<string>): { valid: string[]; dropped: string[] } {
  const valid: string[] = [], dropped: string[] = [];
  for (const id of ids) (known.has(id) ? valid : dropped).push(id);
  return { valid: [...new Set(valid)], dropped };
}
export function resolveRefs(refs: number[], refMap: Map<number, string>): { ids: string[]; dropped: number[] } {
  const ids: string[] = [], dropped: number[] = [];
  for (const r of refs) { const id = refMap.get(r); id ? ids.push(id) : dropped.push(r); }
  return { ids: [...new Set(ids)], dropped };
}
/** Pull [n] citations out of a free-text answer and keep only real ones. */
export function extractCitations(answer: string, refMap: Map<number, string>) {
  const nums = [...answer.matchAll(/\[(\d{1,4})\]/g)].map((m) => +m[1]);
  const { ids, dropped } = resolveRefs(nums, refMap);
  return { ids, droppedRefs: dropped };
}
