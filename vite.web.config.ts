import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The Hive feed site (sub-project C) — a plain React/Vite app, no @crxjs.
// Reuses the shared cloud data layer under src/lib/cloud via the `@` alias.
export default defineConfig({
  root: path.resolve(__dirname, "web"),
  // Load .env from the project root (shared with the extension build), not from
  // `root` (web/) which is where Vite would look by default.
  envDir: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-web"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5180,
    strictPort: true,
  },
});
