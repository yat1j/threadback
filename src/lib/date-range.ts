import type { Message } from "./types";

/**
 * WhatsApp exports don't include a timezone. The parser deliberately stores the
 * timestamp's displayed wall-clock components as UTC components. Date inputs must
 * use the same convention or local timezone offsets can shift a user's range.
 */
export function dateInputValue(ts: number): string {
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toISOString().slice(0, 10);
}

export function timestampFromDateInput(value: string, end = false): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const ts = Date.UTC(year, month, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  const check = new Date(ts);
  // Reject impossible dates instead of silently rolling e.g. Feb 31 into March.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return undefined;
  return ts;
}

export function getDateBounds(messages: Message[]): { from: string; to: string; minTs?: number; maxTs?: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const message of messages) {
    if (Number.isFinite(message.ts)) {
      min = Math.min(min, message.ts);
      max = Math.max(max, message.ts);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { from: "", to: "" };
  return { from: dateInputValue(min), to: dateInputValue(max), minTs: min, maxTs: max };
}

export function timestampFromDateTimeInput(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return undefined;
  const ts = Date.UTC(year, month, day, hour, minute);
  const check = new Date(ts);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return undefined;
  return ts;
}
