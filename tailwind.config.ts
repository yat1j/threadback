import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { fontFamily: { kanit: ["Kanit", "system-ui", "sans-serif"] } } },
  plugins: [],
} satisfies Config;
