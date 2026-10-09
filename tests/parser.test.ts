import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseChat, readExport, validateUpload } from "@/lib/parser";
import { SAMPLE_CHAT } from "@/data/sample";

describe("parser: Android 24h", () => {
  const c = parseChat(SAMPLE_CHAT);
  it("parses messages, participants, system lines", () => {
    expect(c.participants).toEqual(["Asha", "Kabir", "Meera", "Ravi"]);
    expect(c.messages.filter((m) => m.system).length).toBe(2);
    expect(c.messages[0].system).toBe(true);
  });
  it("is not ambiguous when a day > 12 exists", () => {
    expect(c.dateAmbiguous).toBe(false);
    expect(c.dateOrder).toBe("dmy");
  });
  it("keeps multiline text exactly, including a line that looks like a time", () => {
    const m = c.messages.find((x) => x.text.startsWith("Update:"))!;
    expect(m.text).toBe("Update: Café Nine can't do Friday.\n12:05 changed to Saturday 7pm instead");
    expect(m.sender).toBe("Ravi");
  });
  it("flags media placeholders", () => {
    expect(c.messages.filter((m) => m.media).length).toBe(2);
  });
  it("preserves Hinglish and emoji untouched", () => {
    const m = c.messages.find((x) => x.text.includes("kal tak"))!;
    expect(m.text).toBe("Asha kal tak form bhej dena, warna registration late ho jayega");
    expect(c.messages.some((x) => x.text === "👍")).toBe(true);
  });
  it("IDs are stable across re-parses and unique", () => {
    const again = parseChat(SAMPLE_CHAT);
    expect(again.messages.map((m) => m.id)).toEqual(c.messages.map((m) => m.id));
    expect(new Set(c.messages.map((m) => m.id)).size).toBe(c.messages.length);
  });
  it("ts is correct wall-clock", () => {
    expect(new Date(c.messages[2].ts).toISOString()).toBe("2026-10-12T09:02:00.000Z");
  });
});

describe("parser: formats", () => {
  it("Android 12h am/pm with 2-digit year", () => {
    const c = parseChat("13/03/24, 2:05 pm - Sam: hi\n13/03/24, 12:10 am - Lee: night");
    expect(new Date(c.messages[0].ts).toISOString()).toBe("2024-03-13T14:05:00.000Z");
    expect(new Date(c.messages[1].ts).toISOString()).toBe("2024-03-13T00:10:00.000Z");
  });
  it("iOS bracket format with seconds and narrow NBSP PM", () => {
    const c = parseChat("[13/03/2024, 2:05:33\u202fPM] ‎Sam: hello\n[13/03/2024, 14:06:00] Lee: yo");
    expect(c.messages).toHaveLength(2);
    expect(c.messages[0].sender).toBe("Sam");
    expect(new Date(c.messages[0].ts).toISOString()).toBe("2024-03-13T14:05:33.000Z");
  });
  it("US mm/dd inferred when second field > 12", () => {
    const c = parseChat("3/25/24, 9:00 AM - Sam: x");
    expect(c.dateOrder).toBe("mdy");
    expect(new Date(c.messages[0].ts).toISOString()).toBe("2024-03-25T09:00:00.000Z");
  });
  it("FLAGS ambiguous dates instead of guessing silently", () => {
    const c = parseChat("03/04/2024, 09:00 - Sam: x\n04/04/2024, 09:01 - Lee: y");
    expect(c.dateAmbiguous).toBe(true);
    expect(c.warnings.join(" ")).toMatch(/ambiguous/i);
    const forced = parseChat("03/04/2024, 09:00 - Sam: x", { dateOrder: "mdy" });
    expect(new Date(forced.messages[0].ts).toISOString()).toBe("2024-03-04T09:00:00.000Z");
    expect(forced.dateAmbiguous).toBe(false);
  });
  it("system message with no sender and a colon-free body", () => {
    const c = parseChat("13/03/2024, 10:00 - Sam added Lee\n13/03/2024, 10:01 - Lee: hi");
    expect(c.messages[0].system).toBe(true);
    expect(c.messages[0].sender).toBeNull();
  });
  it("garbage input yields a useful warning, no throw", () => {
    const c = parseChat("hello world\nnot a chat");
    expect(c.messages).toHaveLength(0);
    expect(c.warnings[0]).toMatch(/No WhatsApp/);
  });
  it("handles CRLF and BOM", () => {
    const c = parseChat("\ufeff13/03/2024, 10:00 - Sam: a\r\n13/03/2024, 10:01 - Lee: b\r\n");
    expect(c.messages.map((m) => m.text)).toEqual(["a", "b"]);
  });
});

describe("parser: zip + upload validation", () => {
  it("reads _chat.txt from a zip (preferred over other txt)", async () => {
    const z = new JSZip();
    z.file("notes.txt", "irrelevant");
    z.file("_chat.txt", "13/03/2024, 10:00 - Sam: from zip");
    const buf = await z.generateAsync({ type: "arraybuffer" });
    const text = await readExport({ name: "x.zip", arrayBuffer: async () => buf });
    expect(parseChat(text).messages[0].text).toBe("from zip");
  });
  it("zip without txt gives a useful error", async () => {
    const z = new JSZip(); z.file("a.jpg", "x");
    const buf = await z.generateAsync({ type: "arraybuffer" });
    await expect(readExport({ name: "x.zip", arrayBuffer: async () => buf })).rejects.toThrow(/no \.txt/);
  });
  it("plain txt passes through", async () => {
    const buf = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await readExport({ name: "a.txt", arrayBuffer: async () => buf })).toBe("abc");
  });
  it("validates extension / empty", () => {
    expect(validateUpload({ name: "a.pdf", size: 5 })).toMatch(/export/);
    expect(validateUpload({ name: "a.txt", size: 0 })).toMatch(/empty/);
    expect(validateUpload({ name: "a.txt", size: 5 })).toBeNull();
  });
});


describe("ambiguous date-order override", () => {
  it("explicit date-order selection reparses ambiguous numeric dates", () => {
    const input = "04/05/2025, 10:00 - Asha: first\n05/06/2025, 11:00 - Ravi: second";
    const dmy = parseChat(input, { dateOrder: "dmy" });
    const mdy = parseChat(input, { dateOrder: "mdy" });
    expect(new Date(dmy.messages[0].ts).toISOString().slice(0, 10)).toBe("2025-05-04");
    expect(new Date(mdy.messages[0].ts).toISOString().slice(0, 10)).toBe("2025-04-05");
  });
});
