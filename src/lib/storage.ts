import { DEFAULT_CONFIG, type ChatSession, type ConnectionConfig, type StoredMessage } from "./types";

const CONFIG_KEY = "hermes.config";
const SESSIONS_KEY = "hermes.sessions";
const ACTIVE_SESSION_KEY = "hermes.activeSessionId";

export async function loadConfig(): Promise<ConnectionConfig> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const merged: ConnectionConfig = { ...DEFAULT_CONFIG, ...(stored[CONFIG_KEY] ?? {}) };
  return merged;
}

export async function saveConfig(cfg: ConnectionConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: cfg });
}

export async function loadSessions(): Promise<ChatSession[]> {
  const stored = await chrome.storage.local.get(SESSIONS_KEY);
  return (stored[SESSIONS_KEY] as ChatSession[] | undefined) ?? [];
}

export async function saveSessions(sessions: ChatSession[]): Promise<void> {
  await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
}

export async function getActiveSessionId(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(ACTIVE_SESSION_KEY);
  return stored[ACTIVE_SESSION_KEY] as string | undefined;
}

export async function setActiveSessionId(id: string | undefined): Promise<void> {
  if (id === undefined) await chrome.storage.local.remove(ACTIVE_SESSION_KEY);
  else await chrome.storage.local.set({ [ACTIVE_SESSION_KEY]: id });
}

export function newSession(title = "New chat"): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function newMessage(role: StoredMessage["role"], content: string): StoredMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
}
