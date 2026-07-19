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
  "status.auth": { ko: "● 키 오류", en: "● key error", zh: "● 密钥错误" },
  "status.authTip": {
    ko: "서버는 켜져 있지만 저장된 API 키를 거절했습니다 (토큰이 바뀐 듯) — 클릭해서 설정의 '빠른 연결'을 다시 실행하세요.",
    en: "The server is up but rejected the stored API key (token likely rotated) — click to re-run quick connect in Settings.",
    zh: "服务器在线但拒绝了已保存的 API 密钥（令牌可能已更换）— 点击后在设置中重新运行快速连接。",
  },
  // Options page: self-diagnosis banner (probes the saved connection on open)
  "opt.probe.ok": { ko: "🟢 연결 정상 — {url}", en: "🟢 Connected — {url}", zh: "🟢 连接正常 — {url}" },
  "opt.probe.auth": {
    ko: "🟠 서버({url})는 실행 중이지만 저장된 키를 거절합니다 — 게이트웨이 탭에서 '빠른 연결'을 다시 실행하세요.",
    en: "🟠 The server ({url}) is up but rejects the stored key — re-run quick connect in the Gateway tab.",
    zh: "🟠 服务器（{url}）在线但拒绝已保存的密钥 — 请在网关标签页重新运行快速连接。",
  },
  "opt.probe.down": {
    ko: "🔴 서버({url})에 연결할 수 없습니다 — Hermes 서버가 실행 중인지 확인하세요.",
    en: "🔴 Cannot reach the server ({url}) — check that your Hermes server is running.",
    zh: "🔴 无法连接服务器（{url}）— 请确认 Hermes 服务器正在运行。",
  },
  "opt.probe.goGateway": { ko: "게이트웨이 탭 열기", en: "Open Gateway tab", zh: "打开网关标签页" },
  "opt.test.authHint": {
    ko: "서버가 키를 거절했습니다(401) — 게이트웨이 탭의 '빠른 연결'을 다시 실행하세요.",
    en: "The server rejected the key (401) — re-run quick connect in the Gateway tab.",
    zh: "服务器拒绝了密钥（401）— 请在网关标签页重新运行快速连接。",
  },
  "err.401.hint": {
    ko: "API 키가 서버와 일치하지 않습니다. 설정(⚙) → 게이트웨이 탭의 '빠른 연결'을 다시 실행하세요.",
    en: "The API key no longer matches the server. Re-run quick connect in Settings (⚙) → Gateway tab.",
    zh: "API 密钥与服务器不匹配。请在设置（⚙）→ 网关标签页重新运行快速连接。",
  },
  // Actionable 401 card in the chat (button jumps straight to quick connect)
  "err.401.card": {
    ko: "🔑 API 키가 서버와 일치하지 않아요. 토큰이 바뀌었을 수 있습니다 — 아래 버튼으로 다시 연결하세요.",
    en: "🔑 The API key doesn't match the server. The token may have rotated — reconnect with the button below.",
    zh: "🔑 API 密钥与服务器不匹配。令牌可能已更换 — 请用下方按钮重新连接。",
  },
  "err.401.fix": { ko: "⚙ 설정 열고 다시 연결", en: "⚙ Open Settings & reconnect", zh: "⚙ 打开设置并重新连接" },
  // Page-restriction explanations (localized from PageContext.errorKind)
  "pageErr.restricted": {
    ko: "이 페이지는 읽을 수 없어요. 브라우저 내부 페이지(chrome:// 설정, 확장 프로그램 페이지, 새 탭, 웹 스토어)에는 보안상 스크립트를 넣을 수 없어서 요약·번역·설명 기능이 동작하지 않습니다. 일반 웹페이지(http:// 또는 https://)를 연 뒤 다시 시도해 주세요.",
    en: "This page can't be read. Browser-internal pages (chrome:// settings, extension pages, the new-tab page, the Web Store) forbid content scripts for security, so summarize/translate/explain can't run here. Open a normal web page (http:// or https://) and try again.",
    zh: "无法读取此页面。浏览器内部页面（chrome:// 设置、扩展程序页面、新标签页、网上应用店）出于安全考虑禁止注入脚本，因此总结、翻译、解释功能无法在此运行。请打开普通网页（http:// 或 https://）后重试。",
  },
  "pageErr.noTab": {
    ko: "활성 탭을 찾을 수 없어요. 읽을 웹페이지 탭을 클릭한 뒤 다시 시도해 주세요.",
    en: "No active tab found. Click the web-page tab you want to read, then try again.",
    zh: "找不到活动标签页。请点击要读取的网页标签页后重试。",
  },
  "pageErr.empty": {
    ko: "이 페이지에서 읽을 수 있는 텍스트를 찾지 못했어요. 본문이 이미지·캔버스이거나 아직 로딩 중일 수 있습니다.",
    en: "No readable text found on this page. It may be image/canvas-based or still loading.",
    zh: "在此页面未找到可读取的文本。页面可能基于图片/画布，或仍在加载中。",
  },
  statusTitle: { ko: "Hermes 서버 연결 상태", en: "Hermes server connection status", zh: "Hermes 服务器连接状态" },
  switchLang: { ko: "UI 언어: {name}", en: "UI language: {name}", zh: "界面语言：{name}" },
  translateTo: { ko: "📄 페이지 번역", en: "📄 Translate page", zh: "📄 翻译页面" },
  translate: { ko: "🌐 전체 번역", en: "🌐 Whole page", zh: "🌐 整页翻译" },
  translateTitle: { ko: "현재 페이지를 선택한 언어로 번역", en: "Translate the current page into the selected language", zh: "将当前页面翻译为所选语言" },
  translateLangTitle: { ko: "번역 대상 언어 선택", en: "Choose the target language", zh: "选择目标语言" },
  translating: { ko: "번역 중…", en: "Translating…", zh: "翻译中…" },
  stop: { ko: "중지", en: "Stop", zh: "停止" },
  restore: { ko: "↩ 원본", en: "↩ Original", zh: "↩ 原文" },
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
  "bm.shareToHive": { ko: "Hive에 공유", en: "Share to Hive", zh: "分享到 Hive" },
  "bm.shareTitle": { ko: "선택한 폴더를 요약해 Hive에 공유합니다", en: "Summarize the chosen folder and share it to Hive", zh: "总结所选文件夹并分享到 Hive" },
  "bm.sharePick": { ko: "공유할 폴더 선택…", en: "Pick a folder to share…", zh: "选择要分享的文件夹…" },
  "bm.sharing": { ko: "요약하고 공유하는 중…", en: "Summarizing and sharing…", zh: "正在总结并分享…" },
  "bm.shareDone": { ko: "✓ Hive에 공유됨 ({n}개 항목)", en: "✓ Shared to Hive ({n} items)", zh: "✓ 已分享到 Hive（{n} 项）" },
  "bm.shareNeedSignIn": { ko: "공유하려면 먼저 Hive에 로그인하세요.", en: "Sign in to Hive first to share.", zh: "请先登录 Hive 再分享。" },
  "bm.shareFailed": { ko: "공유에 실패했습니다.", en: "Sharing failed.", zh: "分享失败。" },
  "bm.shareCommunity": { ko: "공유할 커뮤니티 선택", en: "Choose a community", zh: "选择社区" },
  "bm.shareNoCommunity": { ko: "커뮤니티 없음", en: "No community", zh: "无社区" },
  "bm.empty": { ko: "작업을 선택하면 변경 미리보기가 여기에 표시됩니다.", en: "Pick an operation to preview changes here.", zh: "选择一项操作以在此预览更改。" },
  "bm.noChanges": { ko: "✓ 수정할 항목이 없습니다 — 이미 깔끔합니다.", en: "✓ Nothing to fix — already clean.", zh: "✓ 无需修改 — 已很整洁。" },
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
  "mr.saveFolder.title": { ko: "다운로드(Downloads) 아래 이 하위 폴더에 보고서 파일이 저장됩니다.", en: "Reports are saved to this subfolder under Downloads.", zh: "报告将保存到 下载 下的此子文件夹。" },
  "mr.autoSave": { ko: "생성되면 파일로 자동 저장", en: "Auto-save to file on generate", zh: "生成后自动保存为文件" },
  "mr.autoSave.title": { ko: "예약 보고서가 만들어질 때마다 저장 폴더에 자동으로 다운로드합니다.", en: "Each scheduled report is auto-downloaded to the save folder.", zh: "每次预约报告生成后自动下载到保存文件夹。" },
  "mr.schedule.title": { ko: "정해진 주기로 백그라운드에서 보고서를 자동 생성합니다.", en: "Generate reports automatically in the background on a schedule.", zh: "按周期在后台自动生成报告。" },
  "mr.save": { ko: "저장", en: "Save", zh: "保存" },
  "mr.saved": { ko: "다운로드 폴더 '{folder}'에 저장됨", en: "Saved to Downloads/{folder}", zh: "已保存到 下载/{folder}" },
  // Plain-language summary of what the current schedule + auto-save settings do.
  "mr.sched.off": { ko: "📌 예약 꺼짐 — '지금 생성'으로 만든 뒤 보고서 옆 ⬇ 로 다운로드하세요.", en: "📌 Not scheduled — use Run now, then ⬇ next to a report to download.", zh: "📌 未预约 — 用“立即生成”，再点报告旁的 ⬇ 下载。" },
  "mr.sched.auto": { ko: "🗓 {freq} {h}:00 자동 생성 → 다운로드 폴더 '{folder}'에 파일로 자동 저장", en: "🗓 Auto-generates {freq} at {h}:00 → auto-saved to Downloads/{folder}", zh: "🗓 {freq} {h}:00 自动生成 → 自动保存到 下载/{folder}" },
  "mr.sched.app": { ko: "🗓 {freq} {h}:00 자동 생성 · 앱에만 보관 (수동 ⬇ 로 다운로드)", en: "🗓 Auto-generates {freq} at {h}:00 · kept in-app only (download with ⬇)", zh: "🗓 {freq} {h}:00 自动生成 · 仅保存在应用内（用 ⬇ 下载）" },
  // Custom report-writing prompt
  "mr.prompt": { ko: "보고서 프롬프트", en: "Report prompt", zh: "报告提示词" },
  "mr.prompt.title": { ko: "보고서를 어떻게 작성할지 지시하는 프롬프트. 비워두면 기본 분석가 프롬프트가 쓰입니다.", en: "Instruction for how to write the report. Empty = built-in analyst prompt.", zh: "撰写报告的指令。留空则使用内置分析师提示词。" },
  "mr.prompt.placeholder": { ko: "예: 투자자 관점에서 리스크 중심으로 요약…  (비우면 기본)", en: "e.g. Summarize risks for an investor…  (empty = default)", zh: "例如：以投资者视角侧重风险…（留空为默认）" },
  "mr.promptSaved": { ko: "저장된 프롬프트", en: "Saved prompts", zh: "已保存提示词" },
  "mr.promptDefault": { ko: "기본 (분석가 프롬프트)", en: "Default (analyst prompt)", zh: "默认（分析师提示词）" },
  "mr.promptSave": { ko: "프롬프트 저장", en: "Save prompt", zh: "保存提示词" },
  "mr.promptDelete": { ko: "삭제", en: "Delete", zh: "删除" },
  "mr.promptNamePrompt": { ko: "이 프롬프트의 이름을 입력하세요:", en: "Name this prompt:", zh: "为该提示词命名：" },
  "mr.promptEmpty": { ko: "저장할 프롬프트 내용을 입력하세요.", en: "Enter prompt text to save.", zh: "请输入要保存的提示词内容。" },
  "mr.promptSavedOk": { ko: "프롬프트 '{name}' 저장됨", en: "Saved prompt '{name}'", zh: "已保存提示词 '{name}'" },

  // Charts (Recharts visualizations)
  "chart.coverage": { ko: "수집 현황", en: "Coverage", zh: "抓取情况" },
  "chart.covered": { ko: "수집됨", en: "Covered", zh: "已抓取" },
  "chart.failed": { ko: "실패", en: "Failed", zh: "失败" },
  "chart.skipped": { ko: "제외됨", en: "Skipped", zh: "已跳过" },
  "chart.trend": { ko: "보고서 추이", en: "Report trend", zh: "报告趋势" },
  "chart.sites": { ko: "사이트", en: "sites", zh: "站点" },
  "chart.actions": { ko: "제안된 정리", en: "Proposed cleanup", zh: "建议清理" },
  "chart.duplicate": { ko: "중복", en: "Duplicate", zh: "重复" },
  "chart.dead": { ko: "깨진 링크", en: "Dead", zh: "失效" },
  "chart.lowValue": { ko: "저가치", en: "Low-value", zh: "低价值" },
  "chart.move": { ko: "이동", en: "Move", zh: "移动" },
  "chart.folders": { ko: "폴더별 북마크", en: "Bookmarks by folder", zh: "各文件夹书签" },
  "chart.noData": { ko: "표시할 데이터가 없습니다.", en: "No data to chart yet.", zh: "暂无可视化数据。" },
  "chart.total": { ko: "전체 {n}개", en: "{n} total", zh: "共 {n} 个" },
  "chart.zoomIn": { ko: "확대", en: "Zoom in", zh: "放大" },
  "chart.zoomOut": { ko: "축소", en: "Zoom out", zh: "缩小" },
  "chart.hide": { ko: "차트 숨기기", en: "Hide chart", zh: "隐藏图表" },
  "chart.show": { ko: "차트 보기", en: "Show chart", zh: "显示图表" },

  // Options: local gateway + Codex auth guidance
  "opt.sec.connection": { ko: "연결", en: "Connection", zh: "连接" },
  "opt.sec.gateway": { ko: "로컬 Hermes 게이트웨이", en: "Local Hermes gateway", zh: "本地 Hermes 网关" },
  "opt.sec.gateway.body": { ko: "로컬 게이트웨이(127.0.0.1:8642)에 연결하는 1회 설정입니다. 두 명령을 터미널에서 실행하세요.", en: "One-time setup to connect to the local gateway (127.0.0.1:8642). Run the two commands in a terminal.", zh: "连接本地网关（127.0.0.1:8642）的一次性设置。在终端运行这两条命令。" },
  "opt.useGateway": { ko: "🖥 로컬 Hermes 게이트웨이 사용", en: "🖥 Use local Hermes gateway", zh: "🖥 使用本地 Hermes 网关" },
  "opt.switchGateway": { ko: "🖥 게이트웨이로 전환", en: "🖥 Switch to gateway", zh: "🖥 切换到网关" },
  "opt.testGatewayFirst": { ko: "이 프로바이더는 직접 연결할 수 없습니다 — 위의 ‘게이트웨이로 전환’ 후 테스트하세요.", en: "This provider can't be reached directly — switch to the gateway above, then test.", zh: "该提供方无法直接连接 — 请先用上方“切换到网关”再测试。" },
  "opt.cors.title": { ko: "게이트웨이 연결 (CORS 설정)", en: "Gateway connection (CORS)", zh: "网关连接（CORS）" },
  "opt.cors.body": { ko: "터미널에서 아래 한 줄을 실행하면 이 확장의 origin을 게이트웨이 CORS 허용에 추가하고 재시작합니다. (1회)", en: "Run this one line in a terminal to allow this extension's origin in the gateway CORS and restart it. (once)", zh: "在终端运行下面这一行，即可将本扩展的 origin 加入网关 CORS 允许列表并重启。（一次）" },
  "opt.cors.copy": { ko: "복사", en: "Copy", zh: "复制" },
  "opt.cors.copied": { ko: "복사됨 ✓", en: "Copied ✓", zh: "已复制 ✓" },
  "opt.connect.title": { ko: "빠른 연결 (한 번에 설정)", en: "Quick connect (one paste)", zh: "快速连接（一次粘贴）" },
  "opt.connect.body": { ko: "터미널에서 아래 명령을 실행해 출력된 한 줄을 복사하고, 아래 칸에 붙여넣은 뒤 [적용]을 누르세요. Base URL·모델·토큰이 한 번에 설정됩니다. (확장은 파일을 직접 읽지 않습니다)", en: "Run this in a terminal, copy the printed line, paste it below and press Apply — Base URL, model, and token are set at once. (the extension never reads the file itself)", zh: "在终端运行下面命令，复制输出的一行，粘贴到下方并点击应用 — 一次设置 Base URL、模型和令牌。（扩展不会自行读取文件）" },
  "opt.connect.placeholder": { ko: "여기에 명령 출력 한 줄을 붙여넣기 (http://… hermes-agent <token>)", en: "Paste the command output here (http://… hermes-agent <token>)", zh: "在此粘贴命令输出（http://… hermes-agent <token>）" },
  "opt.connect.apply": { ko: "적용", en: "Apply", zh: "应用" },
  "opt.connect.ok": { ko: "✓ 연결 설정 완료 — 저장됨", en: "✓ Connected — saved", zh: "✓ 已连接并保存" },
  "opt.connect.err": { ko: "형식이 올바르지 않습니다. 명령 출력 한 줄을 그대로 붙여넣으세요.", en: "Invalid format. Paste the command output line as-is.", zh: "格式不正确。请原样粘贴命令输出行。" },
  "opt.useGateway.note": { ko: "Base URL을 http://127.0.0.1:8642, 모델을 hermes-agent로 설정합니다. API 키에는 ~/.hermes/config.yaml의 api_server.token 값을 넣으세요.", en: "Sets Base URL to http://127.0.0.1:8642 and model to hermes-agent. Put the api_server.token from ~/.hermes/config.yaml in the API key field.", zh: "将 Base URL 设为 http://127.0.0.1:8642，模型设为 hermes-agent。在 API 密钥处填入 ~/.hermes/config.yaml 的 api_server.token。" },
  "opt.codex.title": { ko: "Codex (ChatGPT) 사용하기", en: "Use Codex (ChatGPT)", zh: "使用 Codex (ChatGPT)" },
  "opt.codex.body": { ko: "Codex는 API 키가 아니라 OAuth입니다. 터미널에서 아래를 실행해 로그인한 뒤, 위의 ‘로컬 게이트웨이 사용’으로 연결하세요.", en: "Codex uses OAuth, not an API key. Sign in via the terminal below, then connect with ‘Use local Hermes gateway’ above.", zh: "Codex 使用 OAuth 而非 API 密钥。在终端运行下面命令登录，然后用上方“使用本地网关”连接。" },

  // Slash: server (Hermes) skills
  "slash.skillPrefix": { ko: "{skill} 스킬을 사용해서: ", en: "Use the {skill} skill to: ", zh: "用 {skill} 技能：" },
  "slash.srv.arxiv": { ko: "🔬 arxiv 논문 검색·정리", en: "🔬 arXiv paper search/summary", zh: "🔬 arXiv 论文检索/整理" },
  "slash.srv.github": { ko: "🐙 GitHub 리포·이슈·PR", en: "🐙 GitHub repos/issues/PRs", zh: "🐙 GitHub 仓库/议题/PR" },
  "slash.srv.research": { ko: "📚 심층 리서치", en: "📚 Deep research", zh: "📚 深度研究" },
  "slash.srv.graphify": { ko: "🕸 코드베이스 그래프 분석", en: "🕸 Codebase graph analysis", zh: "🕸 代码库图谱分析" },
  "slash.srv.web": { ko: "🌐 웹 검색", en: "🌐 Web search", zh: "🌐 网页搜索" },
  "slash.srv.dataScience": { ko: "📊 데이터 분석", en: "📊 Data analysis", zh: "📊 数据分析" },
  working: { ko: "● 작업 중…", en: "● Working…", zh: "● 处理中…" },
  inputPlaceholder: { ko: "메시지 입력…", en: "Message…", zh: "输入消息…" },
  slashHint: { ko: "메시지 입력…  ( / 로 명령 )", en: "Message…  ( / for commands )", zh: "输入消息…（输入 / 使用命令）" },
  "slash.title": { ko: "명령", en: "Commands", zh: "命令" },
  noPageText: { ko: "페이지 내용을 읽을 수 없습니다.", en: "Could not read the page content.", zh: "无法读取页面内容。" },
  noResult: { ko: "(결과 없음)", en: "(no result)", zh: "(无结果)" },
  langName: { ko: "언어", en: "Language", zh: "语言" },

  // Skill button labels
  "skill.summarize": { ko: "📝 요약", en: "📝 Summary", zh: "📝 摘要" },
  "skill.keypoints": { ko: "🔑 핵심", en: "🔑 Key points", zh: "🔑 要点" },
  "skill.explain": { ko: "🧒 쉽게", en: "🧒 Explain", zh: "🧒 通俗" },
  "skill.links": { ko: "🔗 링크", en: "🔗 Links", zh: "🔗 链接" },

  // Skill tooltips
  "skill.summarize.title": { ko: "이 페이지 요약", en: "Summarize this page", zh: "总结此页面" },
  "skill.keypoints.title": { ko: "핵심 포인트 추출", en: "Extract key points", zh: "提取要点" },
  "skill.explain.title": { ko: "쉽게 설명", en: "Explain simply", zh: "通俗解释" },
  "skill.links.title": { ko: "페이지 링크 추출", en: "Extract page links", zh: "提取页面链接" },

  // Text shown in the user bubble when a skill runs
  "skill.summarize.user": { ko: "이 페이지를 요약해줘", en: "Summarize this page", zh: "请总结此页面" },
  "skill.keypoints.user": { ko: "핵심 포인트를 정리해줘", en: "List the key points", zh: "请列出要点" },
  "skill.explain.user": { ko: "이 페이지를 쉽게 설명해줘", en: "Explain this page simply", zh: "请通俗解释此页面" },
  "skill.links.user": { ko: "🔗 링크 추출", en: "🔗 Extract links", zh: "🔗 提取链接" },

  // Options page subtitle — reflects the local-hermes default
  "opt.subtitle": {
    ko: "기본 연결은 로컬 Hermes 서버(127.0.0.1:8642)입니다 — 게이트웨이 탭의 '빠른 연결'로 키만 넣으면 바로 동작합니다. 다른 프로바이더(OpenRouter 등)로도 전환할 수 있습니다.",
    en: "The default connection is your local Hermes server (127.0.0.1:8642) — paste the quick-connect line in the Gateway tab and you're done. You can also switch to other providers (OpenRouter, …).",
    zh: "默认连接是本地 Hermes 服务器（127.0.0.1:8642）— 在网关标签页粘贴快速连接一行即可使用，也可切换到其他提供商（OpenRouter 等）。",
  },
  // Selection toolbar: no-API-key guidance (thrown by the SW before any fetch)
  "sel.noKeyLocal": {
    ko: "로컬 Hermes 서버는 실행 중인데 API 키가 없습니다 — 설정(⚙) → 게이트웨이 탭의 '빠른 연결' 한 줄만 실행하면 됩니다.",
    en: "Your local Hermes server is running but no API key is set — run the one-line quick connect in Settings (⚙) → Gateway tab.",
    zh: "本地 Hermes 服务器正在运行，但未设置 API 密钥 — 请在设置（⚙）→ 网关标签页运行一行快速连接。",
  },
  "sel.noKey": {
    ko: "API 키가 설정되지 않았습니다 — 설정(⚙)에서 연결을 구성하세요.",
    en: "No API key configured — open Settings (⚙) to set up a connection.",
    zh: "未配置 API 密钥 — 请在设置（⚙）中配置连接。",
  },
  // Hive (cloud) sign-in — email + password
  hiveSignIn: { ko: "Hive 로그인", en: "Sign in to Hive", zh: "登录 Hive" },
  hiveSignInTitle: { ko: "이메일·비밀번호로 Hive에 로그인", en: "Sign in to Hive with email & password", zh: "使用邮箱和密码登录 Hive" },
  hiveSignOut: { ko: "로그아웃", en: "Sign out", zh: "退出登录" },
  hiveSignedInAs: { ko: "{name} 님으로 로그인됨", en: "Signed in as {name}", zh: "已登录：{name}" },
  hiveSignInError: { ko: "로그인 실패. 다시 시도하세요.", en: "Sign-in failed. Please try again.", zh: "登录失败，请重试。" },
  hiveNotConfigured: { ko: "Hive가 구성되지 않았습니다.", en: "Hive is not configured.", zh: "Hive 尚未配置。" },
  hiveEmail: { ko: "이메일", en: "Email", zh: "邮箱" },
  hiveEmailInvalid: { ko: "올바른 이메일을 입력하세요.", en: "Enter a valid email.", zh: "请输入有效邮箱。" },
  hivePassword: { ko: "비밀번호 (6자 이상)", en: "Password (6+ characters)", zh: "密码（至少 6 位）" },
  hivePasswordShort: { ko: "비밀번호는 6자 이상이어야 합니다.", en: "Password must be at least 6 characters.", zh: "密码至少需要 6 个字符。" },
  hiveGo: { ko: "로그인", en: "Sign in", zh: "登录" },
  hiveSigningIn: { ko: "로그인 중…", en: "Signing in…", zh: "登录中…" },
  hiveFirstNote: { ko: "처음이면 이 이메일·비밀번호로 계정이 만들어져요.", en: "First time? This email & password become your account.", zh: "首次登录将用此邮箱和密码创建账户。" },
  hiveVerifySent: { ko: "받은편지함을 확인하세요 — 확인 링크를 보냈어요. 링크를 누른 뒤 다시 로그인하세요.", en: "Check your inbox — we sent a verification link. Click it, then sign in again.", zh: "请查收邮件——我们已发送验证链接。点击后请重新登录。" },
  hiveForgotPassword: { ko: "비밀번호를 잊으셨나요?", en: "Forgot your password?", zh: "忘记密码？" },
  hiveResetSent: { ko: "받은편지함을 확인하세요 — 비밀번호 재설정 링크를 보냈어요.", en: "Check your inbox — we sent a password-reset link.", zh: "请查收邮件——我们已发送密码重置链接。" },
  hiveCancel: { ko: "취소", en: "Cancel", zh: "取消" },
  hiveQuickStart: { ko: "⚡ 이메일 없이 빠른 시작", en: "⚡ Quick start (no email)", zh: "⚡ 无需邮箱快速开始" },
  hiveQuickStartNote: {
    ko: "이 브라우저 전용 계정을 자동 생성합니다 — 프로필을 지우면 계정도 사라져요.",
    en: "Creates an account tied to this browser — clearing the profile loses it.",
    zh: "自动创建仅限此浏览器的账户 — 清除配置文件后账户会丢失。",
  },
  hiveQuickStartFailed: { ko: "빠른 시작에 실패했습니다. 다시 시도하세요.", en: "Quick start failed. Please try again.", zh: "快速开始失败，请重试。" },
  // Hive server setup (runtime URL — no rebuild)
  "hive.setup.title": { ko: "🐝 Hive 연결", en: "🐝 Connect to Hive", zh: "🐝 连接 Hive" },
  "hive.setup.desc": {
    ko: "운영자가 공유한 Hive 서버 주소를 붙여넣으면 북마크 공유 피드가 켜집니다. 주소를 지우면 다시 꺼집니다.",
    en: "Paste the Hive server address your operator shared to turn on the shared bookmark feed. Clearing it turns Hive back off.",
    zh: "粘贴运营者分享的 Hive 服务器地址即可开启共享书签动态。清除地址即可关闭。",
  },
  "hive.setup.placeholder": { ko: "https://hive.example.com", en: "https://hive.example.com", zh: "https://hive.example.com" },
  "hive.setup.connect": { ko: "연결 테스트 후 저장", en: "Test & save", zh: "测试并保存" },
  "hive.setup.checking": { ko: "서버 확인 중…", en: "Checking server…", zh: "正在检查服务器…" },
  "hive.setup.fail": {
    ko: "서버에 연결할 수 없습니다 — 주소를 확인하세요.",
    en: "Could not reach the server — check the address.",
    zh: "无法连接服务器 — 请检查地址。",
  },
  "hive.setup.invalid": { ko: "올바른 서버 주소가 아닙니다.", en: "Not a valid server URL.", zh: "不是有效的服务器地址。" },
  "hive.setup.saved": { ko: "연결됨 — Hive가 켜졌습니다.", en: "Connected — Hive is on.", zh: "已连接 — Hive 已开启。" },
  "hive.setup.current": { ko: "현재 서버: {url}", en: "Current server: {url}", zh: "当前服务器：{url}" },
  "hive.setup.off": {
    ko: "Hive 꺼짐 — 서버 주소가 설정되지 않았습니다.",
    en: "Hive is off — no server address configured.",
    zh: "Hive 已关闭 — 未配置服务器地址。",
  },
  "hive.setup.disconnect": { ko: "연결 해제", en: "Disconnect", zh: "断开连接" },
  // Hive connection status strip (top of the 🐝 tab)
  "hive.status.connected": { ko: "연결됨", en: "connected", zh: "已连接" },
  "hive.status.unreachable": { ko: "서버 응답 없음", en: "server unreachable", zh: "服务器无响应" },
  "hive.status.checking": { ko: "확인 중…", en: "checking…", zh: "检查中…" },
  "hive.status.signedOut": { ko: "로그인 필요", en: "sign in required", zh: "需要登录" },
  "bm.viewInFeed": { ko: "🐝 피드에서 보기", en: "🐝 View in feed", zh: "🐝 在动态中查看" },
  // Hive feed / agent discussion view
  hiveFeedTitle: { ko: "Hive 피드 — 공유된 폴더와 의견", en: "Hive feed — shared folders & opinions", zh: "Hive 动态 — 共享文件夹与观点" },
  hiveSignInPrompt: { ko: "먼저 상단의 'Hive 로그인'으로 로그인하세요.", en: "Sign in first via 'Sign in to Hive' above.", zh: "请先通过上方“登录 Hive”登录。" },
  hiveNoFolders: { ko: "아직 공유된 폴더가 없습니다. 북마크 뷰에서 폴더를 공유해 보세요.", en: "No shared folders yet. Share one from the Bookmarks view.", zh: "暂无共享文件夹。在书签视图中分享一个。" },
  hiveNoOpinions: { ko: "아직 의견이 없습니다.", en: "No opinions yet.", zh: "暂无观点。" },
  hiveAgentOpine: { ko: "🤖 내 에이전트 의견 남기기", en: "🤖 Post my agent's opinion", zh: "🤖 让我的智能体发表观点" },
  hiveOpining: { ko: "읽고 의견 작성 중…", en: "Reading and forming an opinion…", zh: "正在阅读并形成观点…" },
  hivePost: { ko: "게시", en: "Post", zh: "发布" },
  hivePostFailed: { ko: "게시에 실패했습니다.", en: "Could not post.", zh: "发布失败。" },
  hiveCommentPlaceholder: { ko: "의견을 입력하세요…", en: "Share your opinion…", zh: "分享你的观点…" },
  hiveUpvote: { ko: "이 의견 추천", en: "Upvote this opinion", zh: "为该观点点赞" },
  hiveTopContributors: { ko: "상위 기여자", en: "Top contributors", zh: "顶级贡献者" },
  hiveAuto: { ko: "자율 의견", en: "Auto-opinion", zh: "自动观点" },
  hiveAutoHint: {
    ko: "켜두면 에이전트가 주기적으로 새 폴더를 읽고 의견을 남깁니다",
    en: "When on, your agent periodically reads new folders and posts opinions",
    zh: "开启后，智能体会定期阅读新文件夹并发表观点",
  },
  hiveAutoOff: { ko: "끔", en: "Off", zh: "关闭" },
  hiveAutoHourly: { ko: "매시간", en: "Hourly", zh: "每小时" },
  hiveAutoDaily: { ko: "매일", en: "Daily", zh: "每天" },
  hiveReply: { ko: "답글", en: "Reply", zh: "回复" },
  hiveTabFeed: { ko: "피드", en: "Feed", zh: "动态" },
  hiveTabFeedTip: { ko: "공유된 폴더와 의견을 봅니다", en: "Shared folders & opinions", zh: "查看共享文件夹与观点" },
  hiveTabActivity: { ko: "활동 알림", en: "Activity", zh: "活动通知" },
  hiveTabActivityTip: {
    ko: "활동 알림 — 내 글에 달린 답글·추천·멘션",
    en: "Activity — replies, upvotes, and mentions on your posts",
    zh: "活动通知 — 对你帖子的回复、点赞和提及",
  },
  hiveTabMessages: { ko: "메시지", en: "Messages", zh: "私信" },
  hiveTabMessagesTip: {
    ko: "메시지 — 회원과 1:1 대화(DM)",
    en: "Messages — one-to-one conversations (DM)",
    zh: "私信 — 与成员一对一对话",
  },
  hiveMessageOwner: { ko: "작성자에게 메시지", en: "Message the author", zh: "私信作者" },
  hiveNoActivity: { ko: "아직 활동 알림이 없습니다.", en: "No activity yet.", zh: "暂无动态。" },
  hiveNoConvos: { ko: "대화가 없습니다.", en: "No messages yet.", zh: "暂无消息。" },
  hiveActReply: { ko: "{who}님이 회원님 의견에 답글 — {t}", en: "{who} replied to your opinion — {t}", zh: "{who} 回复了你的观点 — {t}" },
  hiveActOpinion: { ko: "{who}님이 회원님 폴더에 의견 — {t}", en: "{who} posted an opinion on your folder — {t}", zh: "{who} 在你的文件夹发表观点 — {t}" },
  hiveActVote: { ko: "{who}님이 회원님 의견을 추천 — {t}", en: "{who} upvoted your opinion — {t}", zh: "{who} 赞了你的观点 — {t}" },
  hiveActTaskDone: { ko: "{who}님이 내 보드 요청에 답변 — {t}", en: "{who} answered your board request — {t}", zh: "{who} 回答了你的请求 — {t}" },
  hiveActSubmission: { ko: "{who}님이 내 챌린지에 응모 — {t}", en: "{who} entered your challenge — {t}", zh: "{who} 参加了你的挑战 — {t}" },
  hiveActReview: { ko: "{who}님이 내 제출물을 리뷰 — {t}", en: "{who} reviewed your entry — {t}", zh: "{who} 评审了你的提交 — {t}" },
  hiveActWin: { ko: "{who}님이 바운티 수여 — {t}", en: "{who} awarded you the bounty — {t}", zh: "{who} 授予你悬赏 — {t}" },
  hiveActTurn: { ko: "{who}님이 내 회의에서 발언 — {t}", en: "{who} spoke in your meeting — {t}", zh: "{who} 在你的会议中发言 — {t}" },
  hiveAnswer: { ko: "답변", en: "Answer", zh: "回答" },
  hiveDebate: { ko: "토론", en: "Debate", zh: "辩论" },
};

export function t(lang: Lang, key: string): string {
  return STR[key]?.[lang] ?? key;
}

export function isLang(v: unknown): v is Lang {
  return v === "ko" || v === "en" || v === "zh";
}

/** English language name for model prompts (unambiguous for the LLM). */
const LANG_PROMPT_NAME: Record<Lang, string> = { ko: "Korean", en: "English", zh: "Chinese" };

/**
 * System instruction forcing the assistant to answer in the user's selected UI
 * language, regardless of the question's or the page's language.
 */
export function replyLanguageInstruction(lang: Lang): string {
  return `Always write your reply in ${LANG_PROMPT_NAME[lang]}, regardless of the language of the question, the page, or any provided content.`;
}
