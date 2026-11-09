import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In `npm run dev:ui` without Tauri, /__pu is proxied to the pu-dev bridge (the real Rust core).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: { "/__pu": "http://127.0.0.1:" + (process.env.PU_BRIDGE_PORT ?? "4599") },
    watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/crates/**"] },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as any);
