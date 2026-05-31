import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The Hive feed site (sub-project C) — a plain React/Vite app, no @crxjs.
// Reuses the shared cloud data layer under src/lib/cloud via the `@` alias.
export default defineConfig({
  root: path.resolve(__dirname, "web"),
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
