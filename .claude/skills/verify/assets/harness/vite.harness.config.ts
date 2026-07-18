import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Harness build: plain vite (no crxjs — it assumes an extension context).
// Copy this directory to <repo>/harness/ so the ../src alias resolves.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  server: { port: 5181, strictPort: true },
});
