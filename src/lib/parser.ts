import type { DateOrder, Message, ParsedChat } from "./types";

// Android: "12/03/2024, 14:05 - Name: text"   iOS: "[12/03/2024, 14:05:33] Name: text"
// Handles 12h (am/pm, incl. narrow NBSP U+202F), 2- or 4-digit years, . - / separators.
const HEADER =
  /^[\u200e\u200f\ufeff]*\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?[\s\u202f\u00a0]*([APap]\.?\s?[Mm]\.?)?\]?[\s\u202f\u00a0]*(?:-[\s\u202f\u00a0]*)?(.*)$/;

const MEDIA_RE =
  /^[\u200e\u200f]*(<Media omitted>|<attached: .+>|.+ \(file attached\)|(image|video|audio|sticker|GIF|document|Contact card) omitted|<This message was edited>)$/i;
const SYSTEM_HINTS =
  /(created group|added|removed|left|joined|changed (the )?(group|subject|this group|their phone)|security code|messages and calls are end-to-end encrypted|deleted this group|You were added|changed the group description|pinned a message)/i;

interface RawHeader { a: number; b: number; y: number; h: number; mi: number; s: number; ap: string | null; rest: string }

function matchHeader(line: string): RawHeader | null {
  const m = HEADER.exec(line);
  if (!m) return null;
  const [, a, b, y, h, mi, s, ap, rest] = m;
  return { a: +a, b: +b, y: +y, h: +h, mi: +mi, s: s ? +s : 0, ap: ap ? ap.replace(/[.\s]/g, "").toLowerCase() : null, rest };
}

export function detectDateOrder(headers: RawHeader[]): { order: DateOrder; ambiguous: boolean; conflict: boolean } {
  let aGt12 = false, bGt12 = false;
  for (const h of headers) { if (h.a > 12) aGt12 = true; if (h.b > 12) bGt12 = true; }
  if (aGt12 && bGt12) return { order: "dmy", ambiguous: false, conflict: true };
  if (aGt12) return { order: "dmy", ambiguous: false, conflict: false };
  if (bGt12) return { order: "mdy", ambiguous: false, conflict: false };
  return { order: "dmy", ambiguous: true, conflict: false }; // cannot know: default dd/mm, FLAG it
}

function toTs(h: RawHeader, order: DateOrder): number {
  const day = order === "dmy" ? h.a : h.b;
  const month = order === "dmy" ? h.b : h.a;
  const year = h.y < 100 ? 2000 + h.y : h.y;
  let hour = h.h;
  if (h.ap) { hour = hour % 12; if (h.ap.startsWith("p")) hour += 12; }
  return Date.UTC(year, month - 1, day, hour, h.mi, h.s);
}

export function parseChat(input: string, opts: { dateOrder?: DateOrder } = {}): ParsedChat {
  const lines = input.replace(/^\ufeff/, "").split(/\r?\n/);
  const warnings: string[] = [];
  const blocks: { h: RawHeader; first: string; extra: string[] }[] = [];
  let unparsed = 0;

  for (const line of lines) {
    const h = matchHeader(line);
    if (h) blocks.push({ h, first: line, extra: [] });
    else if (blocks.length) blocks[blocks.length - 1].extra.push(line); // multiline continuation
    else if (line.trim()) unparsed++;
  }
  if (!blocks.length) {
    return { messages: [], participants: [], dateOrder: "dmy", dateAmbiguous: false, warnings: ["No WhatsApp-style messages found. Expected lines like “12/03/2024, 14:05 - Name: text”."], unparsedLines: unparsed };
  }

  const det = detectDateOrder(blocks.map((b) => b.h));
  const order = opts.dateOrder ?? det.order;
  if (det.conflict) warnings.push("Dates look inconsistent (both day and month exceed 12). Results may be wrong.");
  if (det.ambiguous && !opts.dateOrder)
    warnings.push("Date format is ambiguous (could be dd/mm or mm/dd). Assumed day/month. Please confirm.");

  const messages: Message[] = [];
  const names = new Set<string>();
  blocks.forEach((b, i) => {
    let body = b.h.rest;
    let sender: string | null = null;
    const sep = body.indexOf(": ");
    if (sep > 0 && sep < 80 && !SYSTEM_HINTS.test(body.slice(0, sep))) {
      sender = body.slice(0, sep).replace(/^[\u200e\u200f~\s]+/, "").trim();
      body = body.slice(sep + 2);
    }
    const text = [body, ...b.extra].join("\n").replace(/\n+$/, "");
    const system = sender === null;
    if (sender) names.add(sender);
    messages.push({
      id: "m" + String(i).padStart(6, "0"), idx: i, ts: toTs(b.h, order), sender, text, system,
      media: !system && MEDIA_RE.test(text.trim()), raw: b.first,
    });
  });

  return { messages, participants: [...names].sort(), dateOrder: order, dateAmbiguous: det.ambiguous && !opts.dateOrder, warnings, unparsedLines: unparsed };
}

/** .txt or .zip export. Browser-only for zip (uses JSZip, loaded lazily). */
export async function readExport(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 2));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK"
  if (!isZip) return new TextDecoder("utf-8").decode(buf);
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  const txts = Object.values(zip.files).filter((f) => !f.dir && /\.txt$/i.test(f.name) && !f.name.startsWith("__MACOSX"));
  if (!txts.length) throw new Error("The .zip has no .txt chat file. Export “Without media” or check the archive.");
  txts.sort((a, b) => Number(/_chat\.txt$|whatsapp chat/i.test(b.name)) - Number(/_chat\.txt$|whatsapp chat/i.test(a.name)));
  return txts[0].async("string");
}

export function validateUpload(file: { name: string; size: number }): string | null {
  if (!/\.(txt|zip)$/i.test(file.name)) return "Please choose a WhatsApp export (.txt or .zip).";
  if (file.size === 0) return "That file is empty.";
  if (file.size > 60 * 1024 * 1024) return "That file is over 60 MB. Export without media.";
  return null;
}
