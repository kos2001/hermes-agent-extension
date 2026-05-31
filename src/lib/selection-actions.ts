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
    `Translate the user's text into ${lang}. If the text is ALREADY written in ` +
    `${lang}, return it unchanged — do not translate or rephrase it. Maintain the ` +
    "tone and style of the original text as much as possible. Return ONLY the " +
    "translation — no quotes, no explanations, no source-language label.",
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

/**
 * Detect the dominant writing script of `text`. Hangul → ko, kana → ja,
 * Han (without kana) → zh, ASCII/Latin letters → latin, else "other".
 * Checked in order so Japanese (kana + kanji) isn't misread as Chinese.
 */
export function detectScript(text: string): "ko" | "ja" | "zh" | "latin" | "other" {
  if (/[가-힣ᄀ-ᇿ㄰-㆏]/.test(text)) return "ko";
  if (/[぀-ゟ゠-ヿ]/.test(text)) return "ja";
  if (/[一-鿿㐀-䶿]/.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "latin";
  return "other";
}

const LANG_SCRIPT: Record<string, "ko" | "ja" | "zh" | "latin"> = {
  Korean: "ko",
  Japanese: "ja",
  Chinese: "zh",
  English: "latin",
  Spanish: "latin",
  French: "latin",
  German: "latin",
};

/**
 * Whether `text` is confidently already in `targetLang`, so a mouse-triggered
 * translation should be skipped. Only returns true for the unambiguous CJK
 * scripts — Latin-script languages (English/Spanish/French/German) can't be
 * distinguished by script, so those are left to the model's "return unchanged
 * if already in the target language" instruction.
 */
export function isSameLanguage(text: string, targetLang: string): boolean {
  const target = LANG_SCRIPT[targetLang];
  if (target === "ko" || target === "ja" || target === "zh") return detectScript(text) === target;
  return false;
}

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
