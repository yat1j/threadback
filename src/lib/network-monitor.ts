import { isModelHost } from "@/config/model";

export interface NetEvent { host: string; method: string; bodyBytes: number | "unknown"; modelHost: boolean; ts: number }
export interface NetSummary { modelHostRequests: number; otherHostRequests: number; bodyBytesSent: number; unknownBodies: number; otherHosts: string[] }

/** Wrap fetch in ANY global scope (window or worker). Records host/method/body SIZE only. Never URLs' paths/queries, never bodies. */
export function patchFetch(scope: { fetch: typeof fetch }, onEvent: (e: NetEvent) => void): () => void {
  const orig = scope.fetch.bind(scope);
  scope.fetch = ((input: any, init?: any) => {
    try {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      const u = new URL(url, "http://self.invalid");
      const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
      const body = init?.body;
      let bodyBytes: number | "unknown" = 0;
      if (body != null) {
        bodyBytes = typeof body === "string" ? new TextEncoder().encode(body).length
          : body instanceof ArrayBuffer ? body.byteLength
          : ArrayBuffer.isView(body) ? body.byteLength
          : typeof Blob !== "undefined" && body instanceof Blob ? body.size : "unknown";
      } else if (input && typeof input === "object" && "body" in input && input.body) bodyBytes = "unknown"; // Request with a stream
      const host = u.hostname === "self.invalid" ? "(same origin)" : u.hostname;
      onEvent({ host, method, bodyBytes, modelHost: host !== "(same origin)" && isModelHost(url), ts: Date.now() });
    } catch { /* monitoring must never break the app */ }
    return orig(input, init);
  }) as typeof fetch;
  return () => { scope.fetch = orig as typeof fetch; };
}

export function summarize(events: NetEvent[]): NetSummary {
  const s: NetSummary = { modelHostRequests: 0, otherHostRequests: 0, bodyBytesSent: 0, unknownBodies: 0, otherHosts: [] };
  for (const e of events) {
    if (e.modelHost) s.modelHostRequests++;
    else if (e.host !== "(same origin)") { s.otherHostRequests++; if (!s.otherHosts.includes(e.host)) s.otherHosts.push(e.host); }
    if (typeof e.bodyBytes === "number") s.bodyBytesSent += e.bodyBytes; else s.unknownBodies++;
  }
  return s;
}
/** "0 bytes of chat sent" is only claimed when no request carried a body AND nothing went to a non-model host. */
export const chatSentIsZero = (s: NetSummary) => s.bodyBytesSent === 0 && s.unknownBodies === 0 && s.otherHostRequests === 0;
