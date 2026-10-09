/**
 * SINGLE SOURCE OF TRUTH for the on-device model and every host the browser may contact.
 * Verified against @mlc-ai/web-llm@0.2.85 prebuiltAppConfig (see README "Model").
 * LICENSE: NOT machine-verified in this build. TODO(you): confirm on the Hugging Face model card
 * before the demo. (Believed Apache-2.0 for Qwen2.5-1.5B; verify.)
 */
export const MODEL = {
  id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  weightsUrl: "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  // compiled WebGPU library, fetched by WebLLM at load time (verified in package source)
  wasmUrl:
    "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
  vramMB: 1629.75, // from WebLLM's prebuilt config
  contextWindow: 4096,
  approxDownloadMB: 1000, // ESTIMATE, not measured. TODO(you): read real size in the Network tab.
  license: "TODO: verify on model card",
} as const;

/** Hosts allowed in CSP connect-src besides 'self'. Model download hosts ONLY. */
export const MODEL_HOSTS = [
  "https://huggingface.co",
  "https://*.huggingface.co",
  "https://*.hf.co", // HF redirects LFS files to a CDN; exact hostname UNVERIFIED -> check Network tab
  "https://raw.githubusercontent.com", // WebLLM fetches the compiled .wasm from here
] as const;

/** Used by the live privacy monitor: a request is "model host" only if it matches. */
export function isModelHost(url: string): boolean {
  try {
    const h = new URL(url, "http://x").hostname;
    return (
      h === "huggingface.co" || h.endsWith(".huggingface.co") || h.endsWith(".hf.co") ||
      h === "raw.githubusercontent.com"
    );
  } catch { return false; }
}
