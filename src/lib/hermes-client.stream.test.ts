import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "./hermes-client";
import type { ConnectionConfig } from "./types";

const CONFIG: ConnectionConfig = {
  baseUrl: "http://127.0.0.1:8642",
  apiKey: "sk-test",
  model: "hermes-3",
};

/** Build a Response whose body streams the given SSE lines as a real stream. */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("streamChat — Hermes agent flow", () => {
  it("posts a streaming chat request and dispatches agent content + tool progress", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        // Agent runs a skill — surfaced as a custom SSE event, not chat content.
        'event: hermes.tool.progress\ndata: {"emoji":"🔧","label":"running web.search"}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" from the agent"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    const tools: string[] = [];
    let done = false;
    let errored = "";

    await streamChat(
      { config: CONFIG, messages: [{ role: "user", content: "hi" }] },
      {
        onChunk: (t) => chunks.push(t),
        onToolProgress: (t) => tools.push(t),
        onError: (m) => {
          errored = m;
        },
        onDone: () => {
          done = true;
        },
      },
    );

    // Request shape: correct endpoint, POST, stream=true, auth header.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8642/v1/chat/completions");
    expect(init.method).toBe("POST");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.stream).toBe(true);
    expect(sentBody.model).toBe("hermes-3");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");

    // Agent behaviour: tool activity reported, content streamed, completion fired.
    expect(tools).toEqual(["🔧 running web.search"]);
    expect(chunks.join("")).toBe("Hello from the agent");
    expect(done).toBe(true);
    expect(errored).toBe("");
  });

  it("reports a stream error payload via onError without content", async () => {
    vi.stubGlobal("fetch", async () =>
      sseResponse(['data: {"error":{"message":"model overloaded"}}\n\n', "data: [DONE]\n\n"]),
    );

    let errored = "";
    const chunks: string[] = [];
    await streamChat(
      { config: CONFIG, messages: [{ role: "user", content: "hi" }] },
      { onChunk: (t) => chunks.push(t), onError: (m) => (errored = m) },
    );
    expect(chunks).toEqual([]);
    expect(errored).toBe("model overloaded");
  });

  it("surfaces an HTTP error body", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401, statusText: "Unauthorized" }));

    let errored = "";
    await streamChat(
      { config: CONFIG, messages: [{ role: "user", content: "hi" }] },
      { onChunk: () => {}, onError: (m) => (errored = m) },
    );
    expect(errored).toContain("401");
    expect(errored).toContain("nope");
  });

  it("returns quietly when aborted mid-stream (no error surfaced)", async () => {
    const controller = new AbortController();
    // A body that aborts after emitting the first chunk, mimicking a user cancel
    // while the agent is still streaming.
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        controller.abort();
      },
    });
    vi.stubGlobal("fetch", async () =>
      new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );

    let errored = "";
    let done = false;
    await streamChat(
      { config: CONFIG, messages: [{ role: "user", content: "hi" }], signal: controller.signal },
      {
        onChunk: () => {},
        onError: (m) => (errored = m),
        onDone: () => (done = true),
      },
    );
    // Abort is expected cancellation — neither an error nor a normal completion.
    expect(errored).toBe("");
    expect(done).toBe(false);
  });
});
