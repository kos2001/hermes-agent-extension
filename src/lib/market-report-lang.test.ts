import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "./types";
import { summarizeSite, synthesizeReport } from "./market-report";

const config: ConnectionConfig = { baseUrl: "http://localhost:8642/v1", model: "test-model" };

/** Stub fetch: capture the request body, return a tiny valid SSE stream. */
function stubFetch(): () => Record<string, unknown> {
  let captured: Record<string, unknown> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      const sse =
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' + "data: [DONE]\n\n";
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }),
  );
  return () => captured;
}

function systemPrompt(body: Record<string, unknown>): string {
  const messages = body.messages as { role: string; content: string }[];
  return messages.find((m) => m.role === "system")?.content ?? "";
}

describe("report language follows the selected UI language", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("synthesizeReport instructs the model to write in the given language (Korean)", async () => {
    const get = stubFetch();
    await synthesizeReport(config, "News", [{ url: "u", title: "t", summary: "s" }], "Korean");
    expect(systemPrompt(get())).toContain("Korean");
  });

  it("synthesizeReport switches language (English)", async () => {
    const get = stubFetch();
    await synthesizeReport(config, "News", [{ url: "u", title: "t", summary: "s" }], "English");
    const prompt = systemPrompt(get());
    expect(prompt).toContain("English");
    expect(prompt).not.toContain("Korean");
  });

  it("summarizeSite instructs the model to write in the given language", async () => {
    const get = stubFetch();
    await summarizeSite(config, "Title", "some page text", "Chinese");
    expect(systemPrompt(get())).toContain("Chinese");
  });
});
