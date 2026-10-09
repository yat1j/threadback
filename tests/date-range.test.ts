import { describe, expect, it } from "vitest";
import { getDateBounds, timestampFromDateInput, timestampFromDateTimeInput } from "@/lib/date-range";
import { filterByRange } from "@/lib/filter";
import type { Message } from "@/lib/types";

function msg(id: string, ts: string, idx: number): Message {
  return { id, idx, ts: Date.parse(ts), sender: "A", text: id, system: false, media: false, raw: id };
}

describe("date range helpers", () => {
  const messages = [
    msg("m3", "2026-10-11T14:00:00.000Z", 2),
    msg("m1", "2026-10-09T09:00:00.000Z", 0),
    msg("m2", "2026-10-10T23:59:59.000Z", 1),
  ];

  it("calculates bounds from min/max timestamps, not file order", () => {
    expect(getDateBounds(messages)).toMatchObject({ from: "2026-10-09", to: "2026-10-11" });
  });

  it("includes every timestamp in an inclusive 3-day calendar range", () => {
    const from = timestampFromDateInput("2026-10-09");
    const to = timestampFromDateInput("2026-10-11", true);
    expect(filterByRange(messages, { from, to })).toHaveLength(3);
  });

  it("keeps date input boundaries timezone-neutral", () => {
    expect(timestampFromDateInput("2026-10-09")).toBe(Date.UTC(2026, 9, 9));
    expect(timestampFromDateInput("2026-10-09", true)).toBe(Date.UTC(2026, 9, 9, 23, 59, 59, 999));
  });

  it("rejects impossible dates and malformed values", () => {
    expect(timestampFromDateInput("2026-02-31")).toBeUndefined();
    expect(timestampFromDateInput("not-a-date")).toBeUndefined();
  });

  it("parses datetime-local as the export's timezone-neutral wall clock", () => {
    expect(timestampFromDateTimeInput("2026-10-09T09:30")).toBe(Date.UTC(2026, 9, 9, 9, 30));
  });
});
