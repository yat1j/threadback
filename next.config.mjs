// MODEL_HOSTS duplicated as plain strings here because next.config can't import TS.
const modelHosts = ["https://huggingface.co","https://*.huggingface.co","https://*.hf.co","https://raw.githubusercontent.com"];
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${modelHosts.join(" ")}`,
  "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");
export default {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ]}];
  },
};
