import type { Grounded } from "./schema";
import { emptyGrounded } from "./schema";
import type { Message } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
const toks = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
export function similar(a: string, b: string, th = 0.6): boolean {
  const A = toks(a), B = toks(b); if (!A.size || !B.size) return norm(a) === norm(b);
  let inter = 0; A.forEach((x) => B.has(x) && inter++);
  return inter / (A.size + B.size - inter) >= th;
}
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

function dedupe<T extends { sources: string[]; flags: string[] }>(items: T[], key: (t: T) => string, join?: (keep: T, dup: T) => void): T[] {
  const out: T[] = [];
  for (const it of items) {
    const hit = out.find((o) => similar(key(o), key(it)));
    if (hit) { hit.sources = union(hit.sources, it.sources); hit.flags = union(hit.flags, it.flags); join?.(hit, it); } else out.push({ ...it });
  }
  return out;
}

const REVISION = /\b(wait|actually|maybe|not sure|tentative|shayad|pata nahi|might)\b|\?/i;
const FINAL = /\b(final|confirmed|confirm ho gaya|pakka|done deal|locked)\b/i;
/** Uncertain if the LATEST cited message sounds like an in-flight revision and carries no finality cue. */
function sourceCue(ids: string[], byId: Map<string, Message>): boolean {
  const t = ids.map((i) => byId.get(i)?.text ?? "").join(" ");
  return REVISION.test(t) && !FINAL.test(t);
}

export function mergeGrounded(parts: Grounded[], byId: Map<string, Message>): Grounded {
  const m = emptyGrounded();
  const ts = (ids: string[]) => Math.min(...ids.map((i) => byId.get(i)?.ts ?? Infinity));
  m.droppedFindings = parts.reduce((a, p) => a + p.droppedFindings, 0);
  m.summary = parts.map((p) => p.summary).filter(Boolean).join(" ");
  m.highlights = dedupe(parts.flatMap((p) => p.highlights), (x) => x.text);
  m.priorities = dedupe(parts.flatMap((p) => p.priorities), (x) => x.text, (k, d) => { if (d.kind === "explicit") k.kind = "explicit"; });
  m.deadlines = dedupe(parts.flatMap((p) => p.deadlines), (x) => x.what + " " + x.when);
  m.topics = dedupe(parts.flatMap((p) => p.topics), (x) => x.title);
  // answered ANYWHERE => answered (never mark unanswered if answered elsewhere)
  m.questions = dedupe(parts.flatMap((p) => p.questions), (x) => x.question, (k, d) => { k.answered = k.answered || d.answered; });
  m.actions = dedupe(parts.flatMap((p) => p.actions), (x) => x.task, (k, d) => {
    k.owner ??= d.owner; k.deadline ??= d.deadline; k.status = k.status === "done" || d.status === "done" ? "done" : k.status ?? d.status;
    if (d.priority === "high") k.priority = "high";
  });
  // decisions: group by topic, order by evidence time. Later does NOT automatically win: uncertainty is kept.
  const groups: typeof m.decisions[] = [];
  for (const d of parts.flatMap((p) => p.decisions)) {
    const g = groups.find((g) => similar(g[0].topic, d.topic, 0.5)); g ? g.push(d) : groups.push([d]);
  }
  m.decisions = groups.map((g) => {
    g.sort((a, b) => ts(a.sources) - ts(b.sources));
    const first = g[0], last = g[g.length - 1];
    const changed = g.length > 1;
    return {
      ...last, topic: first.topic,
      previous: changed ? (last.previous ?? first.latest) : last.previous,
      uncertain: g.some((x) => x.uncertain) || (changed && sourceCue(last.sources, byId)),
      uncertaintyNote: g.map((x) => x.uncertaintyNote).filter(Boolean).pop() ?? (changed ? "Plan changed more than once; confirm the latest." : null),
      sources: [...new Set(g.flatMap((x) => x.sources))],
      flags: [...new Set(g.flatMap((x) => x.flags))],
    };
  });
  return m;
}
