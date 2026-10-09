import { MODEL } from "@/config/model";
import type { ChatMsg, LLM } from "./pipeline";

export interface LoadProgress { progress: number; text: string }

/** Browser-only. Loads Qwen via WebLLM in a Web Worker. NOT RUN in the build sandbox (no WebGPU). */
export async function createLocalLLM(onProgress: (p: LoadProgress) => void): Promise<LLM & { dispose(): Promise<void> }> {
  const webllm = await import("@mlc-ai/web-llm");
  const worker = new Worker(new URL("../workers/llm.worker.ts", import.meta.url), { type: "module" });
  // Fail clearly if model initialization stops reporting progress. The timer is
  // reset on every WebLLM progress event, so slow-but-active downloads can continue.
  let settled = false;
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectStall!: (reason: Error) => void;
  const stalled = new Promise<never>((_, reject) => { rejectStall = reject; });
  const resetStallTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();
        rejectStall(new Error("Local AI loading stopped making progress for 3 minutes. Check your connection, reload the page, and try again. Your chat was not uploaded."));
      }
    }, 180_000);
  };
  resetStallTimer(); // also covers a model that never emits its first progress event
  const initPromise = webllm.CreateWebWorkerMLCEngine(worker, MODEL.id, {
    initProgressCallback: (r) => {
      onProgress({ progress: r.progress, text: r.text });
      resetStallTimer();
    },
  });
  let engine: Awaited<typeof initPromise>;
  try {
    engine = await Promise.race([initPromise, stalled]);
    settled = true;
    if (inactivityTimer) clearTimeout(inactivityTimer);
  } catch (error) {
    settled = true;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    worker.terminate();
    throw error;
  }
  return {
    async complete(messages: ChatMsg[], opts) {
      if (opts?.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const onAbort = () => engine.interruptGenerate();
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const res = await engine.chat.completions.create({
          messages, temperature: 0.2, top_p: 0.9, max_tokens: opts?.maxTokens ?? 800, stream: false,
          ...(opts?.json ? { response_format: { type: "json_object" as const } } : {}),
        });
        if (opts?.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        return res.choices[0]?.message?.content ?? "";
      } finally { opts?.signal?.removeEventListener("abort", onAbort); }
    },
    async dispose() { await engine.unload(); worker.terminate(); },
  };
}

/** Is the model already in the browser's own cache? (decides whether to show the size warning) */
export async function isModelCached(): Promise<boolean> {
  try { return await (await import("@mlc-ai/web-llm")).hasModelInCache(MODEL.id); } catch { return false; }
}
