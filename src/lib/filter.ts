import type { Message } from "./types";

export interface Range { from?: number; to?: number }

/** Inclusive-from, inclusive-to by timestamp. */
export function filterByRange(msgs: Message[], r: Range): Message[] {
  return msgs.filter((m) => (r.from === undefined || m.ts >= r.from) && (r.to === undefined || m.ts <= r.to));
}

/** Everything AFTER the "last read up to here" message (exclusive). Unknown id => throws. */
export function sinceLastRead(msgs: Message[], lastReadId: string): Message[] {
  const i = msgs.findIndex((m) => m.id === lastReadId);
  if (i < 0) throw new Error("Last-read message not found in this chat.");
  return msgs.slice(i + 1);
}

export function sinceTime(msgs: Message[], ts: number): Message[] {
  return msgs.filter((m) => m.ts > ts);
}

/** Selected range plus `pad` surrounding messages on each side (for "Ask this moment"). */
export function withContext(all: Message[], selected: Message[], pad = 5): Message[] {
  if (!selected.length) return [];
  const a = Math.max(0, selected[0].idx - pad);
  const b = Math.min(all.length - 1, selected[selected.length - 1].idx + pad);
  return all.slice(a, b + 1);
}

export interface Stats {
  total: number; participants: number; busiestDay: { day: string; count: number } | null;
  perParticipant: { name: string; count: number }[];
}
export function computeStats(msgs: Message[]): Stats {
  const real = msgs.filter((m) => !m.system);
  const byDay = new Map<string, number>();
  const byP = new Map<string, number>();
  for (const m of real) {
    const d = new Date(m.ts).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
    byP.set(m.sender!, (byP.get(m.sender!) ?? 0) + 1);
  }
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    total: real.length, participants: byP.size,
    busiestDay: busiest ? { day: busiest[0], count: busiest[1] } : null,
    perParticipant: [...byP.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}
