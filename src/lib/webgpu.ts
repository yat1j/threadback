export type GpuStatus = { supported: true; adapterInfo: string } | { supported: false; reason: string };
export async function detectWebGpu(): Promise<GpuStatus> {
  if (typeof navigator === "undefined") return { supported: false, reason: "Not running in a browser." };
  const gpu = (navigator as any).gpu;
  if (!gpu) return { supported: false, reason: "This browser has no WebGPU. Use desktop Chrome or Edge (113+)." };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { supported: false, reason: "WebGPU exists but no usable GPU adapter was found (blocklisted GPU, remote session or disabled flag)." };
    const info = adapter.info ?? {};
    return { supported: true, adapterInfo: [info.vendor, info.architecture].filter(Boolean).join(" ") || "adapter available" };
  } catch (e: any) { return { supported: false, reason: "WebGPU check failed: " + (e?.message ?? "unknown error") }; }
}
