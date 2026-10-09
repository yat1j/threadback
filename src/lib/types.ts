export interface Message {
  id: string;            // stable: m000123 (index in file order)
  idx: number;
  ts: number;            // wall-clock time as UTC ms (timezone-naive: WhatsApp exports carry no zone)
  sender: string | null; // null => system message
  text: string;          // ORIGINAL text, never modified
  system: boolean;
  media: boolean;
  raw: string;           // original first line, for the inspector
}
export type DateOrder = "dmy" | "mdy";
export interface ParsedChat {
  messages: Message[];
  participants: string[];
  dateOrder: DateOrder;
  dateAmbiguous: boolean; // true when the file alone cannot tell dd/mm from mm/dd
  warnings: string[];
  unparsedLines: number;
}
