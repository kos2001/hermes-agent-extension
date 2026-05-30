import { describe, it, expect } from "vitest";
import {
  parseSseBlock,
  processSseData,
  processCustomEvent,
  consumeSseStream,
  type SseCallbacks,
} from "./sse-parser";

describe("parseSseBlock", () => {
  it("extracts data-only block", () => {
    expect(parseSseBlock("data: hello")).toEqual({ eventType: "", data: "hello" });
  });
  it("extracts event + data", () => {
    const block = "event: hermes.tool.progress\ndata: {\"tool\":\"x\"}";
    expect(parseSseBlock(block)).toEqual({
      eventType: "hermes.tool.progress",
      data: '{"tool":"x"}',
    });
  });
  it("returns null when no data line", () => {
    expect(parseSseBlock("event: foo")).toBeNull();
  });
});

describe("processSseData", () => {
  const mkCb = () => {
    const chunks: string[] = [];
    const errors: string[] = [];
    let done = false;
    const cb: SseCallbacks = {
      onChunk: (t) => chunks.push(t),
      onError: (e) => errors.push(e),
      onDone: () => {
        done = true;
      },
    };
    return { cb, chunks, errors, get done() { return done; } };
  };

  it("forwards content delta", () => {
    const { cb, chunks } = mkCb();
    const state = { hasContent: false, lastError: "" };
    processSseData(
      JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }),
      cb,
      state,
    );
    expect(chunks).toEqual(["Hi"]);
    expect(state.hasContent).toBe(true);
  });

  it("signals done on [DONE] after content", () => {
    const h = mkCb();
    const state = { hasContent: true, lastError: "" };
    const res = processSseData("[DONE]", h.cb, state);
    expect(res.done).toBe(true);
    expect(h.done).toBe(true);
  });

  it("captures error payload", () => {
    const { cb } = mkCb();
    const state = { hasContent: false, lastError: "" };
    processSseData(
      JSON.stringify({ error: { message: "rate limit" } }),
      cb,
      state,
    );
    expect(state.lastError).toBe("rate limit");
  });
});

describe("processCustomEvent", () => {
  it("handles hermes.tool.progress", () => {
    const tools: string[] = [];
    const handled = processCustomEvent(
      "hermes.tool.progress",
      JSON.stringify({ tool: "search", emoji: "🔎" }),
      { onToolProgress: (t) => tools.push(t) },
    );
    expect(handled).toBe(true);
    expect(tools).toEqual(["🔎 search"]);
  });

  it("ignores unknown event type", () => {
    expect(processCustomEvent("other", "{}", { onToolProgress: () => {} })).toBe(false);
  });
});

describe("consumeSseStream", () => {
  it("decodes multi-block stream and reports done", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });

    const out: string[] = [];
    let done = false;
    await consumeSseStream(body, {
      onChunk: (t) => out.push(t),
      onDone: () => {
        done = true;
      },
    });
    expect(out.join("")).toBe("Hello world");
    expect(done).toBe(true);
  });
});
