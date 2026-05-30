/**
 * Minimal UI internationalization for the side panel — Korean / English /
 * Chinese. The selected language is persisted in `chrome.storage.local` under
 * `hermes.lang`. `t(lang, key)` returns the localized string (falls back to the
 * key). Model prompts stay English and instruct the model to reply in the
 * page/user language, so only the UI chrome is translated here.
 */

export type Lang = "ko" | "en" | "zh";

export const LANG_KEY = "hermes.lang";

/** Buttons shown in the language switcher. */
export const LANGS: { code: Lang; label: string }[] = [
  { code: "ko", label: "한" },
  { code: "en", label: "EN" },
  { code: "zh", label: "中" },
];

type Entry = Record<Lang, string>;

const STR: Record<string, Entry> = {
  online: { ko: "● 온라인", en: "● online", zh: "● 在线" },
  offline: { ko: "● 오프라인", en: "● offline", zh: "● 离线" },
  translateTo: { ko: "번역 →", en: "Translate →", zh: "翻译 →" },
  translate: { ko: "번역", en: "Translate", zh: "翻译" },
  translating: { ko: "번역 중…", en: "Translating…", zh: "翻译中…" },
  stop: { ko: "중지", en: "Stop", zh: "停止" },
  restore: { ko: "원복", en: "Restore", zh: "还原" },
  restoreTitle: { ko: "원본 페이지 텍스트로 복원", en: "Restore original page text", zh: "还原页面原文" },
  settings: { ko: "설정", en: "Settings", zh: "设置" },
  toLight: { ko: "라이트 모드로 전환", en: "Switch to light mode", zh: "切换到浅色模式" },
  toDark: { ko: "다크 모드로 전환", en: "Switch to dark mode", zh: "切换到深色模式" },
  send: { ko: "전송", en: "Send", zh: "发送" },
  newChat: { ko: "새 대화", en: "New chat", zh: "新对话" },
  newChatTitle: { ko: "대화를 비우고 새로 시작", en: "Clear and start a new conversation", zh: "清空并开始新对话" },
  working: { ko: "● 작업 중…", en: "● Working…", zh: "● 处理中…" },
  inputPlaceholder: { ko: "메시지 입력…", en: "Message…", zh: "输入消息…" },
  noPageText: { ko: "페이지 내용을 읽을 수 없습니다.", en: "Could not read the page content.", zh: "无法读取页面内容。" },
  noResult: { ko: "(결과 없음)", en: "(no result)", zh: "(无结果)" },
  langName: { ko: "언어", en: "Language", zh: "语言" },

  // Skill button labels
  "skill.summarize": { ko: "📝 요약", en: "📝 Summary", zh: "📝 摘要" },
  "skill.keypoints": { ko: "🔑 핵심", en: "🔑 Key points", zh: "🔑 要点" },
  "skill.explain": { ko: "🧒 쉽게", en: "🧒 Explain", zh: "🧒 通俗" },
  "skill.links": { ko: "🔗 링크", en: "🔗 Links", zh: "🔗 链接" },
  "skill.stats": { ko: "⏱ 통계", en: "⏱ Stats", zh: "⏱ 统计" },

  // Skill tooltips
  "skill.summarize.title": { ko: "이 페이지 요약", en: "Summarize this page", zh: "总结此页面" },
  "skill.keypoints.title": { ko: "핵심 포인트 추출", en: "Extract key points", zh: "提取要点" },
  "skill.explain.title": { ko: "쉽게 설명", en: "Explain simply", zh: "通俗解释" },
  "skill.links.title": { ko: "페이지 링크 추출", en: "Extract page links", zh: "提取页面链接" },
  "skill.stats.title": { ko: "읽기 통계 (단어 수·시간)", en: "Reading stats (words, time)", zh: "阅读统计（字数·时间）" },

  // Text shown in the user bubble when a skill runs
  "skill.summarize.user": { ko: "이 페이지를 요약해줘", en: "Summarize this page", zh: "请总结此页面" },
  "skill.keypoints.user": { ko: "핵심 포인트를 정리해줘", en: "List the key points", zh: "请列出要点" },
  "skill.explain.user": { ko: "이 페이지를 쉽게 설명해줘", en: "Explain this page simply", zh: "请通俗解释此页面" },
  "skill.links.user": { ko: "🔗 링크 추출", en: "🔗 Extract links", zh: "🔗 提取链接" },
  "skill.stats.user": { ko: "⏱ 읽기 통계", en: "⏱ Reading stats", zh: "⏱ 阅读统计" },
};

export function t(lang: Lang, key: string): string {
  return STR[key]?.[lang] ?? key;
}

export function isLang(v: unknown): v is Lang {
  return v === "ko" || v === "en" || v === "zh";
}
