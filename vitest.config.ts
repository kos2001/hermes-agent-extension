import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Unit tests must not inherit the operator's gitignored .env (e.g. a local
  // VITE_POCKETBASE_URL makes config.test.ts's "no env default" cases fail);
  // point env loading at a dir with no .env files so tests behave like CI.
  envDir: path.resolve(__dirname, "tests"),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
