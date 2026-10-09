import { describe, it, expect } from "vitest";
import { parseChat } from "@/lib/parser";
import { SAMPLE_CHAT, SAMPLE_USER } from "@/data/sample";
import { filterByRange, sinceLastRead, sinceTime, withContext, computeStats } from "@/lib/filter";
import { detectMention, extractDeadlines, computeSignals, combinePriority } from "@/lib/detect";

const chat = parseChat(SAMPLE_CHAT);
const user = { name: SAMPLE_USER };
const T = (s: string) => Date.parse(s + "Z");

describe("filters", () => {
  it("date range", () => {
    const r = filterByRange(chat.messages, { from: T("2026-10-13T00:00:00"), to: T("2026-10-13T23:59:59") });
    expect(r.length).toBeGreaterThan(5);
    expect(r.every((m) => new Date(m.ts).getUTCDate() === 13)).toBe(true);
  });
  it("since last read is exclusive and validates id", () => {
    const id = chat.messages.find((m) => m.text.startsWith("Okay team"))!.id;
    const r = sinceLastRead(chat.messages, id);
    expect(r[0].text).toBe("sounds good");
    expect(() => sinceLastRead(chat.messages, "nope")).toThrow();
    expect(sinceTime(chat.messages, T("2026-10-14T09:00:00")).length).toBeGreaterThan(0);
  });
  it("withContext pads and clamps", () => {
    const sel = chat.messages.slice(10, 12);
    expect(withContext(chat.messages, sel, 3)).toHaveLength(8);
    expect(withContext(chat.messages, chat.messages.slice(0, 1), 3)[0].idx).toBe(0);
  });
  it("stats", () => {
    const s = computeStats(chat.messages);
    expect(s.participants).toBe(4);
    expect(s.busiestDay!.day).toBe("2026-10-13");
    expect(s.perParticipant.reduce((a, b) => a + b.count, 0)).toBe(s.total);
  });
});

describe("mentions", () => {
  it("matches @Asha, Asha, case-insens; not substrings", () => {
    expect(detectMention("@Asha can you", user)).toBe(true);
    expect(detectMention("hey asha, ok", user)).toBe(true);
    expect(detectMention("Ashank is here", user)).toBe(false);
    expect(detectMention("pasha", user)).toBe(false);
  });
  it("nicknames and full-name first token", () => {
    expect(detectMention("ashu bhej do", { name: "Asha Rao", nicknames: ["Ashu"] })).toBe(true);
    expect(detectMention("Asha ji", { name: "Asha Rao" })).toBe(true);
  });
});

describe("deadlines", () => {
  const ts = T("2026-10-12T11:43:00"); // a Monday
  it("English weekday + EOD", () => {
    const d = extractDeadlines("Due Thursday EOD", ts);
    expect(d.find((x) => x.kind === "weekday")!.date).toBe("2026-10-15");
    expect(d.some((x) => x.kind === "eod")).toBe(true);
  });
  it("tomorrow / ASAP / tonight / next week", () => {
    const d = extractDeadlines("send tomorrow asap, tonight ideally, or next week", ts).map((x) => x.kind + ":" + x.text);
    expect(d).toEqual(expect.arrayContaining(["relative:tomorrow", "urgent:asap", "relative:tonight", "relative:next week"]));
  });
  it("Hinglish kal / aaj / jaldi, with ambiguity flagged for kal", () => {
    const d = extractDeadlines("kal tak bhej dena, jaldi, aaj raat tak", ts);
    const kal = d.find((x) => /kal/i.test(x.text))!;
    expect(kal.ambiguous).toBe(true);
    expect(kal.date).toBe("2026-10-13");
    expect(d.some((x) => x.kind === "urgent" && /jaldi/i.test(x.text))).toBe(true);
    expect(d.some((x) => /aaj raat/i.test(x.text))).toBe(true);
  });
  it("no false positives on 'I sat' / 'sun'", () => {
    expect(extractDeadlines("I sat there in the sun", ts).filter((x) => x.kind === "weekday")).toHaveLength(0);
  });
  it("'next friday' on a friday jumps a week; explicit dates; times", () => {
    const fri = T("2026-10-16T10:00:00");
    expect(extractDeadlines("next friday", fri)[0].date).toBe("2026-10-23");
    expect(extractDeadlines("on 20 Oct", fri).find((x) => x.kind === "explicit")!.date).toBe("2026-10-20");
    expect(extractDeadlines("at 8pm", fri)[0].kind).toBe("time");
  });
});

describe("urgency + triage on the sample chat", () => {
  const sig = computeSignals(chat.messages, chat.messages, user);
  const by = (needle: string) => sig.find((s) => chat.messages[+s.id.slice(1)].text.includes(needle))!;
  it("invoice request to Asha => reply, with reasons", () => {
    const s = by("take the invoice");
    expect(s.triage).toBe("reply");
    expect(s.reasons.length).toBeGreaterThan(2);
    expect(s.score).toBeGreaterThanOrEqual(60);
  });
  it("Hinglish form nag to Asha => reply", () => { expect(by("kal tak form").triage).toBe("reply"); });
  it("cake question to Asha is unanswered => reply", () => { expect(by("cake order").triage).toBe("reply"); });
  it("answered-by-someone-else question to the group is FYI", () => { expect(by("who's driving").triage).toBe("fyi"); });
  it("user's own messages and media score 0", () => {
    expect(by("sounds good").score).toBe(0);
    expect(sig.filter((s) => chat.messages[+s.id.slice(1)].media).every((s) => s.score === 0)).toBe(true);
  });
  it("a deadline-only message to the group is 'deadline'", () => { expect(by("caterer invoice, it has to be paid").triage).toBe("deadline"); });
  it("if the user replies nearby, reply-needed is suppressed", () => {
    const c = parseChat("13/10/2026, 10:00 - Ravi: @Asha can you confirm?\n13/10/2026, 10:02 - Asha: yes done");
    const s = computeSignals(c.messages, c.messages, user)[0];
    expect(s.answeredByUser).toBe(true);
    expect(s.triage).not.toBe("reply");
  });
  it("combine with model", () => {
    expect(combinePriority(60).reason).toMatch(/rules only/);
    expect(combinePriority(60, 90).score).toBe(72);
  });
});
