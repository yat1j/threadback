import type { Message } from "./types";

export interface Chunk { messages: Message[]; core: [number, number]; } // core = indices of NEW (non-overlap) msgs

/** Overlapping chunks bounded by characters (Hinglish tokenises poorly, so stay conservative). */
export function chunkMessages(msgs: Message[], opts: { maxChars?: number; overlap?: number } = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 3500, overlap = opts.overlap ?? 4;
  const usable = msgs.filter((m) => !m.system || m.text.length < 0); // system lines carry no tasks
  const out: Chunk[] = []; let i = 0;
  while (i < usable.length) {
    let chars = 0, j = i;
    while (j < usable.length && (chars + usable[j].text.length + 40 <= maxChars || j === i)) { chars += usable[j].text.length + 40; j++; }
    const from = Math.max(0, i - (out.length ? overlap : 0));
    out.push({ messages: usable.slice(from, j).map((m) => ({ ...m, text: m.text.length > 1200 ? m.text.slice(0, 1200) + "…" : m.text })), core: [i, j - 1] });
    i = j;
  }
  return out;
}
