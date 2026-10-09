import type { Message } from "./types";

export interface UserProfile { name: string; nicknames?: string[] }
export interface DeadlinePhrase {
  text: string;
  kind: "urgent" | "eod" | "relative" | "weekday" | "explicit" | "time";
  date?: string;      // YYYY-MM-DD, resolved relative to the message's own timestamp
  ambiguous?: boolean;
  note?: string;
}
export type Triage = "reply" | "deadline" | "fyi";
export interface Signals {
  id: string; mention: boolean; directQuestion: boolean; request: boolean;
  deadlines: DeadlinePhrase[]; urgentWord: boolean; answeredByUser: boolean;
  score: number; reasons: string[]; triage: Triage;
}

const DAY_MS = 86400000;
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const dayStart = (ts: number) => Math.floor(ts / DAY_MS) * DAY_MS;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ---------------- mentions ---------------- */
export function nameVariants(u: UserProfile): string[] {
  const full = u.name.trim();
  const first = full.split(/\s+/)[0];
  return [...new Set([full, first, ...(u.nicknames ?? [])].map((s) => s.trim()).filter((s) => s.length >= 2))];
}
export function detectMention(text: string, u: UserProfile): boolean {
  for (const v of nameVariants(u)) {
    // Unicode-aware word boundary: not preceded/followed by a letter or digit. Allows "@Asha", "Asha,".
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])@?~?${esc(v)}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(text)) return true;
  }
  return false;
}

/* ---------------- questions / requests ---------------- */
const Q_WORDS = /(\?|\b(kya|kab|kaun|kyun|kyu|kaise|kahan|kitne|kitna|hai kya|ho gaya|ho gya)\b)/i;
const REQUEST = /\b(can you|could you|would you|will you|please|pls|plz|need you|kar do|karo|karna|bhej|bhejna|dena|de do|confirm|send|book|take care|handle|ping)\b/i;
export const isQuestion = (t: string) => Q_WORDS.test(t);
export const isRequest = (t: string) => REQUEST.test(t);

/* ---------------- deadline / date phrases ---------------- */
const WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const WD_RE = /\b(?:(by|on|before|till|until|this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/gi;
const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const EXPLICIT = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+(\d{4}))?\b/gi;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/gi;

function nextWeekday(from: number, wd: number, forceNext: boolean): number {
  const cur = new Date(from).getUTCDay();
  let diff = (wd - cur + 7) % 7;
  if (forceNext && diff === 0) diff = 7;
  return dayStart(from) + diff * DAY_MS;
}

export function extractDeadlines(text: string, ts: number): DeadlinePhrase[] {
  const out: DeadlinePhrase[] = [];
  const base = dayStart(ts);
  const add = (p: DeadlinePhrase) => { if (!out.some((o) => o.text.toLowerCase() === p.text.toLowerCase())) out.push(p); };

  for (const m of text.matchAll(/\b(asap|urgent(?:ly)?|immediately|right away)\b/gi)) add({ text: m[0], kind: "urgent" });
  for (const m of text.matchAll(/\b(jaldi|turant|abhi)\b/gi)) add({ text: m[0], kind: "urgent", note: "Hinglish: soon/now" });
  for (const m of text.matchAll(/\b(eod|cob|end of (?:the )?day)\b/gi)) add({ text: m[0], kind: "eod", date: iso(base) });
  for (const m of text.matchAll(/\b(tonight|today|aaj(?: raat| shaam)?)\b/gi)) add({ text: m[0], kind: "relative", date: iso(base) });
  for (const m of text.matchAll(/\b(tomorrow|tmrw|tmr)\b/gi)) add({ text: m[0], kind: "relative", date: iso(base + DAY_MS) });
  for (const m of text.matchAll(/\b(kal)\b(?:\s+tak)?/gi))
    add({ text: m[0], kind: "relative", date: iso(base + DAY_MS), ambiguous: true,
      note: "Hindi “kal” can mean yesterday or tomorrow; assumed tomorrow (deadline context)." });
  for (const m of text.matchAll(/\b(parso)\b/gi))
    add({ text: m[0], kind: "relative", date: iso(base + 2 * DAY_MS), ambiguous: true, note: "“parso” can mean day after tomorrow or day before yesterday; assumed future." });
  for (const m of text.matchAll(/\bnext week\b/gi)) add({ text: m[0], kind: "relative", date: iso(base + 7 * DAY_MS), note: "approximate: +7 days" });
  for (const m of text.matchAll(/\bthis week\b/gi)) add({ text: m[0], kind: "relative", note: "sometime this week" });

  for (const m of text.matchAll(WD_RE)) {
    const prep = m[1]?.toLowerCase();
    const raw = m[2].toLowerCase();
    const isShort = raw.length <= 4 && !WEEKDAYS.includes(raw);
    if (isShort && !prep) continue; // avoid "I sat", "Sun", "mon" noise without a preposition
    const wd = WEEKDAYS.findIndex((d) => d.startsWith(raw.slice(0, 3)));
    if (wd < 0) continue;
    add({ text: m[0].trim(), kind: "weekday", date: iso(nextWeekday(base, wd, prep === "next")) });
  }
  for (const m of text.matchAll(EXPLICIT)) {
    const mo = MONTHS.indexOf(m[2].toLowerCase());
    const y = m[3] ? +m[3] : new Date(ts).getUTCFullYear();
    add({ text: m[0], kind: "explicit", date: iso(Date.UTC(y, mo, +m[1])) });
  }
  for (const m of text.matchAll(TIME_RE)) add({ text: m[0], kind: "time" });
  return out;
}

/* ---------------- scoring ---------------- */
export interface ScoreOpts { now?: number; answerWindowMsgs?: number; answerWindowMs?: number }

export function computeSignals(all: Message[], target: Message[], user: UserProfile, opts: ScoreOpts = {}): Signals[] {
  const now = opts.now ?? all[all.length - 1]?.ts ?? Date.now();
  const winMsgs = opts.answerWindowMsgs ?? 8;
  const winMs = opts.answerWindowMs ?? 90 * 60000;
  const me = user.name.trim().toLowerCase();

  return target.map((m): Signals => {
    const base: Signals = { id: m.id, mention: false, directQuestion: false, request: false, deadlines: [], urgentWord: false, answeredByUser: false, score: 0, reasons: [], triage: "fyi" };
    if (m.system || m.media) return { ...base, reasons: ["system or media message"] };
    const fromMe = m.sender?.toLowerCase() === me;
    const deadlines = extractDeadlines(m.text, m.ts);
    const urgentWord = deadlines.some((d) => d.kind === "urgent");
    if (fromMe) return { ...base, deadlines, urgentWord, reasons: ["sent by you"] };

    const mention = detectMention(m.text, user);
    const q = isQuestion(m.text), req = isRequest(m.text);
    const directQuestion = mention && q;
    const request = mention && req;
    const answeredByUser = all.slice(m.idx + 1, m.idx + 1 + winMsgs)
      .some((n) => n.sender?.toLowerCase() === me && n.ts - m.ts <= winMs && !n.media);

    const reasons: string[] = []; let score = 0;
    if (mention) { score += 25; reasons.push("mentions you (+25)"); }
    if (directQuestion) { score += 20; reasons.push("asks you a question (+20)"); }
    if (request) { score += 15; reasons.push("requests something of you (+15)"); }
    const real = deadlines.filter((d) => d.kind !== "time");
    if (real.length) {
      score += 15; reasons.push(`date/deadline phrase “${real[0].text}” (+15)`);
      const soon = real.find((d) => d.date && Date.parse(d.date) - now <= 2 * DAY_MS && Date.parse(d.date) - now >= -DAY_MS);
      if (soon) { score += 15; reasons.push(`falls within ~2 days of the latest message (+15)`); }
    }
    if (urgentWord) { score += 15; reasons.push("urgency word (+15)"); }
    const needs = mention || directQuestion || request;
    if (needs && !answeredByUser) { score += 10; reasons.push("no reply from you nearby (+10; heuristic)"); }
    if (needs && answeredByUser) { reasons.push("you replied shortly after (heuristic)"); score = Math.max(0, score - 20); }
    score = Math.min(100, score);

    let triage: Triage = "fyi";
    if (needs && !answeredByUser && score >= 35) triage = "reply";
    else if (real.length && score >= 30) triage = "deadline";
    return { ...base, mention, directQuestion, request, deadlines, urgentWord, answeredByUser, score, reasons, triage };
  });
}

/** Final priority = rule score combined with local-model judgment when available. */
export function combinePriority(rule: number, model?: number): { score: number; reason: string } {
  if (model === undefined) return { score: rule, reason: `rules only (${rule})` };
  const s = Math.round(0.6 * rule + 0.4 * model);
  return { score: s, reason: `0.6×rules(${rule}) + 0.4×local model(${model}) = ${s}` };
}
