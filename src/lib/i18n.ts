/**
 * Minimal UI internationalization for the side panel — Korean / English /
 * Chinese. The selected language is persisted in `chrome.storage.local` under
 * `hermes.lang`. `t(lang, key)` returns the localized string (falls back to the
 * key). Model prompts stay English and instruct the model to reply in the
 * page/user language, so only the UI chrome is translated here.
 */

export type Lang = "ko" | "en" | "zh";

export const LANG_KEY = "hermes.lang";

/** Buttons shown in the language switcher (`name` is the hover description). */
export const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: "ko", label: "한", name: "한국어" },
  { code: "en", label: "EN", name: "English" },
  { code: "zh", label: "中", name: "中文" },
];

type Entry = Record<Lang, string>;

const STR: Record<string, Entry> = {
  online: { ko: "● 온라인", en: "● online", zh: "● 在线" },
  offline: { ko: "● 오프라인", en: "● offline", zh: "● 离线" },
  statusTitle: { ko: "Hermes 서버 연결 상태", en: "Hermes server connection status", zh: "Hermes 服务器连接状态" },
  switchLang: { ko: "UI 언어: {name}", en: "UI language: {name}", zh: "界面语言：{name}" },
  translateTo: { ko: "번역 →", en: "Translate →", zh: "翻译 →" },
  translate: { ko: "번역", en: "Translate", zh: "翻译" },
  translateTitle: { ko: "현재 페이지를 선택한 언어로 번역", en: "Translate the current page into the selected language", zh: "将当前页面翻译为所选语言" },
  translateLangTitle: { ko: "번역 대상 언어 선택", en: "Choose the target language", zh: "选择目标语言" },
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
  // Bookmarks organizer
  bookmarks: { ko: "북마크", en: "Bookmarks", zh: "书签" },
  bookmarksTitle: { ko: "즐겨찾기 정리", en: "Organize bookmarks", zh: "整理书签" },
  backToChat: { ko: "채팅으로", en: "Back to chat", zh: "返回聊天" },
  "bm.dedup": { ko: "중복 제거", en: "Duplicates", zh: "去重" },
  "bm.dead": { ko: "깨진 링크", en: "Dead links", zh: "失效链接" },
  "bm.aiClean": { ko: "AI 정리", en: "AI cleanup", zh: "AI 清理" },
  "bm.aiClean.title": { ko: "AI로 중복·깨진·의미 없는 링크 찾기", en: "Find duplicate, dead, and low-value links with AI", zh: "用 AI 查找重复、失效和无意义的链接" },
  "bm.cleaning": { ko: "AI 정리 분석 중…", en: "Analyzing for cleanup…", zh: "正在分析清理…" },
  "bm.aiDup": { ko: "AI 중복", en: "AI dupes", zh: "AI 去重" },
  "bm.aiDup.title": { ko: "제목·앞 문장으로 내용이 같은 중복 페이지 찾기 (AMP·단축·타도메인 등)", en: "Find same-content duplicate pages by title + first sentences (AMP, shortened, cross-domain)", zh: "按标题和前几句查找内容相同的重复页面（AMP、短链、跨域）" },
  "bm.dupAnalyzing": { ko: "의미 중복 분석 중…", en: "Analyzing for duplicates…", zh: "正在分析重复…" },
  "bm.ai": { ko: "AI 자동 분류", en: "AI categorize", zh: "AI 分类" },
  "bm.empty": { ko: "작업을 선택하면 변경 미리보기가 여기에 표시됩니다.", en: "Pick an operation to preview changes here.", zh: "选择一项操作以在此预览更改。" },
  "bm.apply": { ko: "적용", en: "Apply", zh: "应用" },
  "bm.selected": { ko: "{n}개 선택됨", en: "{n} selected", zh: "已选 {n} 项" },
  "bm.applied": { ko: "적용 {a}건, 실패 {f}건", en: "{a} applied, {f} failed", zh: "已应用 {a} 项，失败 {f} 项" },
  "bm.confirmRemove": { ko: "{n}개의 북마크를 삭제합니다. 계속할까요?", en: "Delete {n} bookmark(s). Continue?", zh: "将删除 {n} 个书签。继续？" },
  "bm.needConfig": { ko: "AI 분류를 쓰려면 먼저 설정에서 연결을 구성하세요.", en: "Configure a connection in settings to use AI categorize.", zh: "请先在设置中配置连接以使用 AI 分类。" },
  "bm.aiNoResult": { ko: "분류 결과가 없습니다 (모델 응답을 해석하지 못함).", en: "No categorization result (could not parse the model reply).", zh: "无分类结果（无法解析模型回复）。" },
  "bm.aiSkipped": { ko: "{n}개는 한도 초과로 건너뜀", en: "{n} skipped (over the limit)", zh: "{n} 项因超出上限被跳过" },
  "bm.tagDup": { ko: "중복", en: "duplicate", zh: "重复" },
  "bm.tagDead": { ko: "깨진 링크", en: "dead link", zh: "失效" },
  "bm.tagJunk": { ko: "의미 없음", en: "low-value", zh: "无意义" },
  "bm.whyDup": { ko: "정규화 URL이 동일", en: "same canonical URL", zh: "规范化 URL 相同" },
  "bm.whyDead": { ko: "응답 없음 (404/네트워크 실패)", en: "no response (404 / network failure)", zh: "无响应（404/网络失败）" },
  "bm.whyJunk": { ko: "저가치 링크", en: "low-value link", zh: "低价值链接" },
  "bm.selectAll": { ko: "전체 선택", en: "Select all", zh: "全选" },
  "bm.selectNone": { ko: "전체 해제", en: "Clear all", zh: "全部取消" },
  "bm.open": { ko: "사이트 열기", en: "Open site", zh: "打开网站" },
  "bm.openSelected": { ko: "선택 항목 열기", en: "Open selected", zh: "打开所选" },
  "bm.confirmOpen": { ko: "{n}개 사이트를 새 탭으로 엽니다. 계속할까요?", en: "Open {n} sites in new tabs?", zh: "在新标签页打开 {n} 个网站？" },
  // Market-trends report
  home: { ko: "홈 (채팅)", en: "Home (chat)", zh: "主页（聊天）" },
  market: { ko: "시장 동향", en: "Market", zh: "市场动向" },
  marketTitle: { ko: "시장 동향 보고서", en: "Market-trends report", zh: "市场动向报告" },
  "mr.folder": { ko: "폴더", en: "Folder", zh: "文件夹" },
  "mr.pickFolder": { ko: "폴더 선택…", en: "Pick a folder…", zh: "选择文件夹…" },
  "mr.schedule": { ko: "주기", en: "Schedule", zh: "周期" },
  "mr.freq.off": { ko: "끄기", en: "Off", zh: "关闭" },
  "mr.freq.daily": { ko: "매일", en: "Daily", zh: "每天" },
  "mr.freq.weekly": { ko: "매주", en: "Weekly", zh: "每周" },
  "mr.atHour": { ko: "시각", en: "At", zh: "时间" },
  "mr.run": { ko: "지금 생성", en: "Run now", zh: "立即生成" },
  "mr.running": { ko: "보고서 생성 중…", en: "Generating report…", zh: "正在生成报告…" },
  "mr.latest": { ko: "최신 보고서", en: "Latest report", zh: "最新报告" },
  "mr.history": { ko: "이전 보고서", en: "History", zh: "历史报告" },
  "mr.empty": { ko: "폴더를 선택하고 '지금 생성'을 누르세요.", en: "Pick a folder and press Run now.", zh: "选择文件夹并点击立即生成。" },
  "mr.needConfig": { ko: "먼저 설정에서 연결을 구성하세요.", en: "Configure a connection in settings first.", zh: "请先在设置中配置连接。" },
  "mr.noFolder": { ko: "북마크가 있는 폴더가 없습니다.", en: "No folders with bookmarks found.", zh: "未找到含书签的文件夹。" },
  "mr.skipped": { ko: "{n}개 사이트는 상한(20)으로 제외됨", en: "{n} sites skipped (cap 20)", zh: "{n} 个站点因上限(20)被跳过" },
  "mr.siteError": { ko: "수집 실패", en: "fetch failed", zh: "抓取失败" },
  "mr.saveFolder": { ko: "저장 폴더", en: "Save folder", zh: "保存文件夹" },
  "mr.autoSave": { ko: "자동 저장", en: "Auto-save", zh: "自动保存" },
  "mr.save": { ko: "저장", en: "Save", zh: "保存" },
  "mr.saved": { ko: "다운로드 폴더 '{folder}'에 저장됨", en: "Saved to Downloads/{folder}", zh: "已保存到 下载/{folder}" },
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
