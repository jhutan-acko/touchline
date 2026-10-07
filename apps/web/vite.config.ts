import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// The API (pnpm api) serves RPC over WebSocket at /rpc; the dev server forwards it, so the app talks to its own origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/rpc": { target: "ws://127.0.0.1:8787", ws: true } } },
  test: { environment: "jsdom", globalSetup: ["../../vitest.tmp.ts"], setupFiles: ["test/setup.ts"], testTimeout: 120_000 }
})
