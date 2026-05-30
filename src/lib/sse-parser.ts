/**
 * SSE parsing for Hermes / OpenAI-compatible chat completions stream.
 *
 * Ported verbatim from hermes-desktop/src/main/sse-parser.ts so that the desktop
 * test fixtures stay valid against this client too. Pure functions — no Electron,
 * no fetch — safe to use in MV3 service workers and the test runner.
 */

export interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

export interface SseCallbacks {
  onChunk: (text: string) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: ParsedUsage) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

const toolProgressRe = /^`([^\s`]+)\s+([^`]+)`$/;

export function processCustomEvent(
  eventType: string,
  data: string,
  cb: Pick<SseCallbacks, "onToolProgress">,
): boolean {
  if (eventType === "hermes.tool.progress" && cb.onToolProgress) {
    try {
      const payload = JSON.parse(data);
      const label = payload.label || payload.tool || "";
      const emoji = payload.emoji || "";
      cb.onToolProgress(emoji ? `${emoji} ${label}` : label);
      return true;
    } catch {
      /* malformed — skip */
    }
  }
  return false;
}

export interface SseDataResult {
  done: boolean;
  hasContent: boolean;
  error?: string;
}

export function processSseData(
  data: string,
  cb: SseCallbacks,
  state: { hasContent: boolean; lastError: string },
): SseDataResult {
  if (data === "[DONE]") {
    if (state.hasContent) cb.onDone?.();
    return { done: true, hasContent: state.hasContent, error: state.lastError };
  }

  try {
    const parsed = JSON.parse(data);

    if (parsed.error) {
      state.lastError = parsed.error.message || JSON.stringify(parsed.error);
      return { done: false, hasContent: state.hasContent };
    }

    const delta = parsed.choices?.[0]?.delta;

    if (parsed.usage && cb.onUsage) {
      cb.onUsage({
        promptTokens: parsed.usage.prompt_tokens || 0,
        completionTokens: parsed.usage.completion_tokens || 0,
        totalTokens: parsed.usage.total_tokens || 0,
        cost: parsed.usage.cost,
        rateLimitRemaining: parsed.usage.rate_limit_remaining,
        rateLimitReset: parsed.usage.rate_limit_reset,
      });
    }

    if (delta?.content) {
      const content = delta.content.trim();
      const match = toolProgressRe.exec(content);
      if (match && cb.onToolProgress) {
        cb.onToolProgress(`${match[1]} ${match[2]}`);
      } else {
        state.hasContent = true;
        cb.onChunk(delta.content);
      }
    }
  } catch {
    /* malformed chunk — skip */
  }

  return { done: false, hasContent: state.hasContent };
}

export function parseSseBlock(
  block: string,
): { eventType: string; data: string } | null {
  let eventType = "";
  let dataLine = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) eventType = line.slice(7).trim();
    else if (line.startsWith("data: ")) dataLine = line.slice(6);
  }
  if (!dataLine) return null;
  return { eventType, data: dataLine };
}

/**
 * Iterate a `fetch()` body stream and dispatch SSE events to callbacks.
 * Blocks (separated by `\n\n`) are buffered across chunks.
 */
export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  cb: SseCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state = { hasContent: false, lastError: "" };
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseBlock(block);
        if (!parsed) continue;
        if (parsed.eventType && processCustomEvent(parsed.eventType, parsed.data, cb)) continue;
        const result = processSseData(parsed.data, cb, state);
        if (result.done) {
          if (result.error && !state.hasContent) cb.onError?.(result.error);
          return;
        }
      }
    }

    if (state.lastError && !state.hasContent) cb.onError?.(state.lastError);
  } finally {
    reader.releaseLock();
  }
}
