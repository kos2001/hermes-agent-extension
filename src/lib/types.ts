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
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "openrouter/auto",
  headers: {
    // OpenRouter attribution headers (optional but recommended).
    "HTTP-Referer": "https://github.com/local/hermes-agent-extension",
    "X-Title": "Hermes Agent Extension",
  },
};

// Provider presets now live in `src/lib/providers.ts` (the full Hermes Agent
// provider registry). See PROVIDERS / getProvider there.
