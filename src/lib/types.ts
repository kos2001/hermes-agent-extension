export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface StoredMessage extends ChatMessage {
  id: string;
  createdAt: number;
  /** Tool progress lines emitted while assistant was streaming. */
  toolProgress?: string[];
  error?: string;
  /**
   * When set, the error bubble renders an actionable card instead of raw text.
   * "reconnect" = the key was rejected; the card offers a one-click jump to the
   * gateway quick-connect (see App.tsx).
   */
  errorAction?: "reconnect";
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

export interface ConnectionConfig {
  /** Base URL — no trailing slash, no `/v1` suffix. */
  baseUrl: string;
  apiKey?: string;
  /** Default model id passed to /v1/chat/completions. */
  model: string;
  /** Optional custom HTTP headers (e.g. for gateway auth). */
  headers?: Record<string, string>;
}

export const DEFAULT_CONFIG: ConnectionConfig = {
  // Out of the box the extension targets the local hermes-agent api_server —
  // its primary use case. A key is still required (Settings → quick connect);
  // cloud providers are opt-in via the provider picker, which applies their
  // base URL / model / attribution headers (see providers.ts).
  baseUrl: "http://127.0.0.1:8642",
  apiKey: "",
  model: "hermes-agent",
  headers: {},
};

// Provider presets now live in `src/lib/providers.ts` (the full Hermes Agent
// provider registry). See PROVIDERS / getProvider there.
