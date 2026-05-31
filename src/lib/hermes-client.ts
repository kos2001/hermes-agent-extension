/**
 * Hermes HTTP client adapted from hermes-desktop/src/main/hermes.ts.
 *
 * The desktop app shells out to the CLI but also speaks to its local HTTP API at
 * http://127.0.0.1:8642. Chrome extensions cannot spawn processes — so this
 * client speaks ONLY the HTTP surface (which is what the desktop "remote mode"
 * uses too). Same OpenAI-compatible endpoints: /health, /v1/chat/completions,
 * /v1/models.
 */

import { consumeSseStream, type SseCallbacks } from "./sse-parser";
import type { ChatMessage, ConnectionConfig } from "./types";

/** Trim trailing slashes and an accidentally-pasted endpoint suffix. */
export function normaliseBaseUrl(raw: string): string {
  let url = (raw || "").trim().replace(/\/+$/, "");
  url = url.replace(/\/(chat\/completions|responses)\/*$/i, "");
  return url;
}

/**
 * Build a full endpoint from a provider base URL.
 *
 * Provider base URLs already include their version path (`…/v1`, `…/v1beta`,
 * `…/api/paas/v4`, `…/compatible-mode/v1`), so we just append `path`. Bare
 * hosts with no version segment (`http://127.0.0.1:8642`, `https://openrouter.ai/api`)
 * get a `/v1` inserted — preserving older saved configs that omit it.
 */
export function joinApi(base: string, path: string): string {
  const b = normaliseBaseUrl(base);
  const hasVersion = /\/v\d/i.test(b) || /\/gateway\/?$/i.test(b);
  return hasVersion ? `${b}/${path}` : `${b}/v1/${path}`;
}

/**
 * Heuristic: does this base URL point at a (local) Hermes agent server rather
 * than a cloud LLM API? Used to decide whether it's safe to attach the
 * `X-Hermes-Session-Id` header (cloud APIs may reject it on CORS preflight).
 */
export function isHermesEndpoint(baseUrl: string): boolean {
  return (
    /(?:^|\/\/)(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(baseUrl) ||
    /:8642(?:\/|$)/.test(baseUrl)
  );
}

export class HermesError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "HermesError";
  }
}

/**
 * First character in `value` that `fetch` cannot put in an HTTP header.
 * Header values must be Latin-1 (ISO-8859-1, code points 0–255); anything
 * above that (Korean, emoji, em-dash, smart quotes, stray invisible chars
 * from copy-paste, …) makes fetch throw before any request is sent.
 */
export function findNonLatin1(
  value: string,
): { char: string; index: number; codePoint: number } | null {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0xff) {
      const codePoint = value.codePointAt(i) ?? value.charCodeAt(i);
      return { char: String.fromCodePoint(codePoint), index: i, codePoint };
    }
  }
  return null;
}

/**
 * Throw a precise HermesError if any header value contains a non-Latin-1
 * character — naming the header and the offending character — instead of
 * letting `fetch` raise its opaque "String contains non ISO-8859-1 code
 * point" error. `labels` renames a header for the message (Authorization is
 * surfaced as "API key", since that is where the user actually fixes it).
 */
export function assertHeadersLatin1(
  headers: Record<string, string>,
  labels: Record<string, string> = {},
): void {
  for (const [name, value] of Object.entries(headers)) {
    const bad = findNonLatin1(value);
    if (!bad) continue;
    const where = labels[name] ?? `header "${name}"`;
    const cp = `U+${bad.codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    throw new HermesError(
      `${where} contains a character that can't be sent in an HTTP header: ` +
        `"${bad.char}" (${cp}) at position ${bad.index}. HTTP headers allow only ` +
        "Latin-1 (ISO-8859-1) characters — delete it and retype the value.",
    );
  }
}

function authHeaders(cfg: ConnectionConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(cfg.headers ?? {}),
  };
  const key = cfg.apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  assertHeadersLatin1(headers, { Authorization: "API key" });
  return headers;
}

/** Probe the catalog (`/models`) as a universal health/reachability check. */
export async function checkHealth(cfg: ConnectionConfig, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(joinApi(cfg.baseUrl, "models"), { signal, headers: authHeaders(cfg) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface HermesModel {
  id: string;
  object?: string;
  owned_by?: string;
}

/** GET /v1/models. */
export async function listModels(cfg: ConnectionConfig, signal?: AbortSignal): Promise<HermesModel[]> {
  const res = await fetch(joinApi(cfg.baseUrl, "models"), { signal, headers: authHeaders(cfg) });
  if (!res.ok) throw new HermesError(`models: HTTP ${res.status}`, res.status);
  const json = (await res.json()) as { data?: HermesModel[] };
  return json.data ?? [];
}

export interface StreamChatRequest {
  config: ConnectionConfig;
  messages: ChatMessage[];
  /** Override config.model for this request. */
  model?: string;
  signal?: AbortSignal;
  /**
   * OpenAI `response_format` (e.g. `{ type: "json_object" }`). Forwarded as-is
   * to the API. Only set it for models known to support structured output —
   * providers that don't may reject the request.
   */
  responseFormat?: Record<string, unknown>;
}

/** POST /v1/chat/completions with stream=true; dispatches deltas to callbacks. */
export async function streamChat(
  req: StreamChatRequest,
  cb: SseCallbacks,
): Promise<void> {
  const url = joinApi(req.config.baseUrl, "chat/completions");
  const body = JSON.stringify({
    model: req.model ?? req.config.model,
    messages: req.messages,
    stream: true,
    ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
  });

  // NOTE: do not add custom request headers (e.g. X-Hermes-Session-Id) here.
  // The Hermes API server's CORS allow-list is `Authorization, Content-Type,
  // Idempotency-Key` only, so any other header fails the browser preflight and
  // breaks the request. The server derives session continuity from the
  // conversation itself, so stateful skills/memory still work without one.
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: authHeaders(req.config),
      body,
      signal: req.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // HermesError here means a pre-flight validation failure (e.g. a non-Latin-1
    // header) — surface it verbatim rather than as a misleading network error.
    cb.onError?.(e instanceof HermesError ? msg : `Network error: ${msg}`);
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    cb.onError?.(`HTTP ${res.status}: ${text || res.statusText}`);
    return;
  }

  await consumeSseStream(res.body, cb, req.signal);
}

/**
 * Non-streaming convenience: run a chat request and return the full text.
 * Accumulates `streamChat` deltas; rejects with HermesError on stream error.
 */
export async function collectChat(req: StreamChatRequest): Promise<string> {
  let acc = "";
  let error: string | null = null;
  await streamChat(req, {
    onChunk: (d) => {
      acc += d;
    },
    onError: (m) => {
      if (!error) error = m;
    },
  });
  if (error) throw new HermesError(error);
  return acc;
}
