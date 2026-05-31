/**
 * Client-side skills — one-click actions that run in the browser extension,
 * using the extension's page access (and optionally the LLM). Unlike Hermes
 * server-side skills (which need the agent runtime), these work against any
 * provider because the page text / DOM data is gathered here and either sent to
 * the model (prompt skills) or computed locally (local skills).
 */

import type { ChatMessage } from "./types";

/** A skill that sends the current page's text to the model with an instruction. */
export interface PromptSkill {
  id: string;
  /** Button label (with emoji). */
  label: string;
  /** Tooltip. */
  title: string;
  /** System instruction; the page text is appended. */
  system: string;
  /** Text shown in the user bubble when the skill runs. */
  userText: string;
}

export const PROMPT_SKILLS: PromptSkill[] = [
  {
    id: "summarize",
    label: "📝 요약",
    title: "이 페이지 요약",
    system:
      "You are a concise assistant. Summarize the web page below in 3–5 sentences, " +
      "capturing its main points.",
    userText: "이 페이지를 요약해줘",
  },
  {
    id: "keypoints",
    label: "🔑 핵심",
    title: "핵심 포인트 추출",
    system:
      "Extract the key points of the web page below as a short Markdown bullet list " +
      "(max 7 bullets).",
    userText: "핵심 포인트를 정리해줘",
  },
  {
    id: "explain",
    label: "🧒 쉽게",
    title: "쉽게 설명",
    system:
      "Explain what the web page below is about in simple, plain language a beginner " +
      "can understand.",
    userText: "이 페이지를 쉽게 설명해줘",
  },
];

/** Build the model messages for a prompt skill from the captured page text. */
export function buildSkillMessages(skill: PromptSkill, pageText: string): ChatMessage[] {
  return [
    { role: "system", content: `${skill.system}\n\n--- PAGE CONTENT ---\n${pageText}` },
    { role: "user", content: skill.userText },
  ];
}
