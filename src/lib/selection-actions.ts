/**
 * Selection actions — the page-assist "copilot" feature, ported.
 *
 * page-assist (https://github.com/n4ze3m/page-assist) lets you select text on
 * any page and run an AI action on it (Summarize / Explain / Rephrase /
 * Translate). There it is wired through the right-click context menu; here we
 * surface the same action set as a floating toolbar that appears right on the
 * mouse selection (the "drag to translate / agent" UX), and stream the result
 * back inline.
 *
 * This module is the single source of truth shared by the content script (which
 * renders the toolbar) and the service worker (which runs the model). The
 * prompt templates are adapted from page-assist's default copilot prompts in
 * `src/services/application.ts`.
 */

import type { ChatMessage } from "./types";

export type SelectionActionKey = "translate" | "summary" | "explain" | "rephrase";

export interface SelectionActionDef {
  key: SelectionActionKey;
  /** Compact button label shown on the floating toolbar. */
  label: string;
  /** Tooltip / result-panel header. */
  title: string;
}

/** Mirrors page-assist's builtin copilot menu (minus the free-form "custom"). */
export const SELECTION_ACTIONS: SelectionActionDef[] = [
  { key: "translate", label: "번역", title: "Translate" },
  { key: "summary", label: "요약", title: "Summarize" },
  { key: "explain", label: "설명", title: "Explain" },
  { key: "rephrase", label: "의역", title: "Rephrase" },
];

/**
 * Build the chat messages for a selection action. Adapted from page-assist's
 * default copilot prompts; reshaped into a system+user pair so the selected
 * text is never confused with the instruction.
 */
export function buildSelectionMessages(
  action: SelectionActionKey,
  text: string,
  targetLang: string,
): ChatMessage[] {
  const system = SYSTEM_PROMPTS[action](targetLang);
  return [
    { role: "system", content: system },
    { role: "user", content: text },
  ];
}

const SYSTEM_PROMPTS: Record<SelectionActionKey, (targetLang: string) => string> = {
  translate: (lang) =>
    `Translate the user's text into ${lang}. Maintain the tone and style of the ` +
    "original text as much as possible. Return ONLY the translation — no quotes, " +
    "no explanations, no source-language label.",
  summary: () =>
    "Provide a concise summary of the user's text, capturing its main ideas and " +
    "key points. Summarize in no more than 3-4 sentences. Return only the summary.",
  explain: () =>
    "Provide a clear explanation of the user's text. Clarify any complex terms or " +
    "ideas, give relevant background, and discuss the significance or implications " +
    "of the content so that someone with little prior knowledge can understand it.",
  rephrase: () =>
    "Rewrite the user's text in a different way, preserving its original meaning " +
    "but using alternative vocabulary and sentence structures. Return ONLY the " +
    "rephrased text.",
};

const TRANSLATE_TARGET_KEY = "hermes.translateTarget";

/** Shared with the side panel's page-translate target selector. */
export async function getTranslateTarget(): Promise<string> {
  const r = await chrome.storage.local.get(TRANSLATE_TARGET_KEY);
  return (r[TRANSLATE_TARGET_KEY] as string) || "English";
}

/** Target languages offered for the Translate action (shared with the side panel). */
export const TRANSLATE_LANGUAGES = [
  "English",
  "Korean",
  "Japanese",
  "Chinese",
  "Spanish",
  "French",
  "German",
] as const;

/** Port name used between the selection toolbar and the service worker. */
export const SELECTION_PORT = "selection-action";

/** Messages the content script sends over the port. */
export interface SelectionRequest {
  action: SelectionActionKey;
  text: string;
  /** Target language for the Translate action; falls back to the stored target. */
  targetLang?: string;
}

/** Messages the service worker streams back over the port. */
export type SelectionResponse =
  | { type: "chunk"; delta: string }
  | { type: "progress"; line: string }
  | { type: "done" }
  | { type: "error"; message: string };
