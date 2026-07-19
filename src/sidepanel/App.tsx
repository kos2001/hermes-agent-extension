import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isHermesEndpoint, streamChat } from "@/lib/hermes-client";
import { renderMarkdown } from "@/lib/markdown";
import type { ChatMessage, ConnectionConfig, StoredMessage } from "@/lib/types";
import { loadConfig, newMessage } from "@/lib/storage";
import {
  capturePageContext,
  formatContextForPrompt,
  getActiveTab,
  pageErrorMessage as pageErrorMessageBase,
  type PageContext,
} from "@/lib/page-context";
import { restoreOriginals, translatePage } from "@/lib/translator";
import { buildSkillMessages, PROMPT_SKILLS, type PromptSkill } from "@/lib/skills";
import { isLang, LANG_KEY, replyLanguageInstruction, t, type Lang } from "@/lib/i18n";
import { isEnterSubmit } from "@/lib/keyboard";
import { HiveSignIn } from "./HiveSignIn";
// Lazy-loaded: keep the bookmark/market views and their AI modules out of the
// initial (chat) bundle — they load only when the user opens those views.
const BookmarksView = lazy(() => import("./BookmarksView"));
const MarketReportView = lazy(() => import("./MarketReportView"));
const HiveFeedView = lazy(() => import("./HiveFeedView"));

/** Local skill (runs in the page): list unique http links as a Markdown list. */
function extractLinksInPage(): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    const href = (a as HTMLAnchorElement).href;
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    seen.add(href);
    const text = (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80) || href;
    items.push(`- [${text}](${href})`);
    if (items.length >= 100) break;
  }
  return items.length ? `**${items.length} links**\n\n${items.join("\n")}` : "링크를 찾지 못했습니다.";
}

/** "auth" = server reachable but it rejected the stored key (rotated token). */
type HealthState = "unknown" | "online" | "offline" | "auth";
type Theme = "dark" | "light";

const THEME_KEY = "hermes.theme";

// Server-side Hermes skills surfaced as slash commands when connected to the
// gateway. Selecting one prefills the input so the user finishes the request;
// the agent then auto-invokes the named skill.
const SERVER_SKILLS: { name: string; labelKey: string }[] = [
  { name: "arxiv", labelKey: "slash.srv.arxiv" },
  { name: "github", labelKey: "slash.srv.github" },
  { name: "research", labelKey: "slash.srv.research" },
  { name: "graphify", labelKey: "slash.srv.graphify" },
  { name: "web", labelKey: "slash.srv.web" },
  { name: "data-science", labelKey: "slash.srv.dataScience" },
];

/** Apply the theme to the document root so the CSS variables switch. */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/**
 * Memoized markdown view. During streaming the whole message list re-renders
 * on every frame; `memo` + `useMemo` mean only the message whose text actually
 * changed re-parses markdown — stable messages are skipped entirely.
 */
const MarkdownView = memo(function MarkdownView({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});

export default function App() {
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
  const [health, setHealth] = useState<HealthState>("unknown");
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState("");
  const [view, setView] = useState<"chat" | "bookmarks" | "market" | "hive">("chat");
  const [streaming, setStreaming] = useState(false);
  // Current-page context is still included in chat silently; the toggle UI was removed.
  const usePage = true;
  const [pageCtx, setPageCtx] = useState<PageContext | null>(null);
  const [targetLang, setTargetLangState] = useState("English");
  const setTargetLang = useCallback((lang: string) => {
    setTargetLangState(lang);
    void chrome.storage.local.set({ "hermes.translateTarget": lang });
  }, []);
  const [theme, setThemeState] = useState<Theme>("dark");
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    void chrome.storage.local.set({ [THEME_KEY]: next });
  }, []);
  // UI language is loaded from storage and kept in sync via the storage
  // onChanged listener below; it's *set* in the options page, not here.
  const [lang, setLangState] = useState<Lang>("ko");
  const [translateBusy, setTranslateBusy] = useState(false);
  const [translateProgress, setTranslateProgress] = useState<{ done: number; total: number } | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const translateAbortRef = useRef<AbortController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Refresh page context when tab changes / activates.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      capturePageContext().then((ctx) => {
        if (!cancelled) setPageCtx(ctx);
      });
    };
    refresh();
    const onActivated = () => refresh();
    const onUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (changeInfo.status === "complete" || changeInfo.title) refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // Initial load + react to options-page edits.
  useEffect(() => {
    let cancelled = false;
    loadConfig().then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    chrome.storage.local.get(["hermes.translateTarget", THEME_KEY, LANG_KEY]).then((r) => {
      if (cancelled) return;
      if (typeof r["hermes.translateTarget"] === "string") {
        setTargetLangState(r["hermes.translateTarget"]);
      }
      const stored = r[THEME_KEY];
      if (stored === "light" || stored === "dark") {
        setThemeState(stored);
        applyTheme(stored);
      }
      if (isLang(r[LANG_KEY])) setLangState(r[LANG_KEY]);
    });
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (area !== "local") return;
      if (changes["hermes.config"]) {
        loadConfig().then((cfg) => setConfig(cfg));
      }
      const nextTheme = changes[THEME_KEY]?.newValue;
      if (nextTheme === "light" || nextTheme === "dark") {
        setThemeState(nextTheme);
        applyTheme(nextTheme);
      }
      if (isLang(changes[LANG_KEY]?.newValue)) setLangState(changes[LANG_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);

  // Probe health when config becomes available and every 15s while idle.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const probe = () => {
      // Skip the network round-trip (and the re-render it triggers) while the
      // panel is hidden — nothing is on screen to update.
      if (document.visibilityState === "hidden") return;
      chrome.runtime.sendMessage({ type: "hermes/health" }, (res) => {
        if (cancelled) return;
        if (chrome.runtime.lastError) {
          setHealth("offline");
          return;
        }
        setHealth(res?.state === "auth" ? "auth" : res?.ok ? "online" : "offline");
      });
    };
    probe();
    const id = setInterval(probe, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [config]);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Shared streaming turn: shows a user bubble (`displayText`) + a streaming
  // assistant bubble, and streams `history` from the model. Used by both the
  // chat box and the one-click skills.
  const streamTurn = useCallback(
    async (history: ChatMessage[], displayText: string) => {
      if (!config || streaming) return;
      const userMsg = newMessage("user", displayText);
      const assistantMsg: StoredMessage = { ...newMessage("assistant", ""), toolProgress: [] };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const updateAssistant = (patch: Partial<StoredMessage>) => {
        setMessages((prev) => {
          let idx = -1;
          for (let k = prev.length - 1; k >= 0; k--) {
            if (prev[k].id === assistantMsg.id) {
              idx = k;
              break;
            }
          }
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], ...patch };
          return next;
        });
      };

      let acc = "";
      const toolLines: string[] = [];
      // Coalesce streaming updates to one React update per animation frame.
      let rafId = 0;
      let dirty = false;
      const flush = () => {
        rafId = 0;
        if (!dirty) return;
        dirty = false;
        updateAssistant({ content: acc, ...(toolLines.length ? { toolProgress: [...toolLines] } : {}) });
      };
      const schedule = () => {
        dirty = true;
        if (!rafId) rafId = requestAnimationFrame(flush);
      };

      // Force the reply into the user's selected UI language (한/中/영). Prepended
      // as the first system message so it overrides any page/question language.
      const messages: ChatMessage[] = [
        { role: "system", content: replyLanguageInstruction(lang) },
        ...history,
      ];

      try {
        await streamChat(
          { config, messages, signal: controller.signal },
          {
            onChunk: (delta) => {
              acc += delta;
              schedule();
            },
            onToolProgress: (line) => {
              toolLines.push(line);
              schedule();
            },
            onError: (msg) =>
              // A rejected key (401) becomes an actionable card (one-click
              // reconnect), not opaque JSON + a text instruction to read.
              updateAssistant(
                /HTTP 401/.test(msg) && isHermesEndpoint(config.baseUrl)
                  ? { error: t(lang, "err.401.card"), errorAction: "reconnect" }
                  : { error: msg },
              ),
            onDone: () => schedule(),
          },
        );
      } finally {
        if (rafId) cancelAnimationFrame(rafId);
        updateAssistant({ content: acc, ...(toolLines.length ? { toolProgress: [...toolLines] } : {}) });
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [config, streaming, lang],
  );

  const send = useCallback(async () => {
    if (!config || streaming) return;
    const text = input.trim();
    if (!text) return;
    setInput("");

    // Re-capture at send time so the context reflects the page right now.
    let ctxNow: PageContext | null = pageCtx;
    if (usePage) {
      ctxNow = await capturePageContext();
      setPageCtx(ctxNow);
    }

    const history: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content: text });
    if (usePage && ctxNow && !ctxNow.error && (ctxNow.text || ctxNow.selection)) {
      history.unshift({ role: "system", content: formatContextForPrompt(ctxNow) });
    }
    await streamTurn(history, text);
  }, [config, input, messages, streaming, pageCtx, usePage, streamTurn]);

  // Run a prompt skill: capture the page text and ask the model to act on it.
  const runPromptSkill = useCallback(
    async (skill: PromptSkill) => {
      if (!config || streaming) return;
      const ctx = await capturePageContext();
      setPageCtx(ctx);
      const display = t(lang, `skill.${skill.id}.user`);
      if (!ctx || ctx.error || !ctx.text.trim()) {
        // Show the localized, detailed reason (restricted page / no tab / …)
        // rather than the raw English capture error.
        const reason = ctx ? pageErrorMessageBase(ctx, lang) || t(lang, "noPageText") : t(lang, "noPageText");
        setMessages((prev) => [
          ...prev,
          newMessage("user", display),
          { ...newMessage("assistant", ""), error: reason },
        ]);
        return;
      }
      await streamTurn(buildSkillMessages(skill, ctx.text), display);
    },
    [config, streaming, streamTurn, lang],
  );

  // Run the local "extract links" skill entirely in the page (no model).
  const runLocalSkill = useCallback(
    async () => {
      if (streaming) return;
      const tab = await getActiveTab();
      if (!tab || tab.id === undefined) return;
      const label = t(lang, "skill.links.user");
      try {
        const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinksInPage });
        const md = (res[0]?.result as string | undefined) ?? t(lang, "noResult");
        setMessages((prev) => [...prev, newMessage("user", label), newMessage("assistant", md)]);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          newMessage("user", label),
          { ...newMessage("assistant", ""), error: e instanceof Error ? e.message : String(e) },
        ]);
      }
    },
    [streaming, lang],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Start a fresh conversation: abort any in-flight stream and clear the
  // transcript + input box.
  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
  }, []);

  // Append a generated market report to the chat transcript.
  const appendReport = useCallback((markdown: string) => {
    setMessages((prev) => [...prev, newMessage("assistant", markdown)]);
  }, []);

  const runTranslate = useCallback(async () => {
    if (!config || translateBusy) return;
    setTranslateError(null);
    setTranslateProgress({ done: 0, total: 0 });
    const tab = await getActiveTab();
    if (!tab || tab.id === undefined) {
      setTranslateError("No active tab");
      return;
    }
    setTranslateBusy(true);
    const controller = new AbortController();
    translateAbortRef.current = controller;
    try {
      const result = await translatePage({
        tabId: tab.id,
        config,
        targetLang,
        signal: controller.signal,
        onProgress: (done, total) => setTranslateProgress({ done, total }),
        onError: (_i, msg) => setTranslateError(msg),
      });
      if (result.chunks === 0) setTranslateError("No translatable text found");
    } catch (e) {
      if (controller.signal.aborted) return; // user/unmount cancelled — not an error
      setTranslateError(e instanceof Error ? e.message : String(e));
    } finally {
      translateAbortRef.current = null;
      setTranslateBusy(false);
    }
  }, [config, targetLang, translateBusy]);

  const runRestore = useCallback(async () => {
    const tab = await getActiveTab();
    if (!tab || tab.id === undefined) return;
    await restoreOriginals(tab.id);
    setTranslateProgress(null);
    setTranslateError(null);
  }, []);

  // ── Slash commands ──────────────────────────────────────────────────
  // Typing "/" in the chat box opens a filterable menu of the same actions
  // available as buttons (skills, translate, new chat, view switches). The
  // command names are language-neutral tokens so they're typeable in any UI lang.
  const [slashIdx, setSlashIdx] = useState(0);
  // Server (Hermes) skills only make sense against the local gateway / a Hermes
  // endpoint — hide them when pointed at a plain cloud provider.
  const hermesConnected = !!config && isHermesEndpoint(config.baseUrl);
  const slashCommands = useMemo<{ name: string; label: string; run?: () => void; insert?: string }[]>(
    () => [
      ...PROMPT_SKILLS.map((s) => ({ name: s.id, label: t(lang, `skill.${s.id}`), run: () => void runPromptSkill(s) })),
      { name: "links", label: t(lang, "skill.links"), run: () => void runLocalSkill() },
      { name: "translate", label: t(lang, "translate"), run: () => void runTranslate() },
      { name: "new", label: t(lang, "newChat"), run: () => newChat() },
      { name: "bookmarks", label: t(lang, "bookmarks"), run: () => setView("bookmarks") },
      { name: "market", label: t(lang, "market"), run: () => setView("market") },
      ...(hermesConnected
        ? SERVER_SKILLS.map((s) => ({
            name: s.name,
            label: t(lang, s.labelKey),
            insert: t(lang, "slash.skillPrefix").replace("{skill}", s.name),
          }))
        : []),
    ],
    [lang, hermesConnected, runPromptSkill, runLocalSkill, runTranslate, newChat],
  );
  const slashQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : null;
  const slashOpen = view === "chat" && !streaming && slashQuery !== null && !/\s/.test(slashQuery);
  const slashMatches = slashOpen ? slashCommands.filter((c) => c.name.startsWith(slashQuery ?? "")) : [];
  const slashSel = Math.min(slashIdx, Math.max(0, slashMatches.length - 1));
  const runSlash = (cmd: { run?: () => void; insert?: string }) => {
    setSlashIdx(0);
    // Server-skill commands prefill the input so the user completes the request;
    // action commands run immediately and clear the box.
    if (cmd.insert !== undefined) {
      setInput(cmd.insert);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    setInput("");
    cmd.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash menu keyboard handling takes precedence over send while it's open.
    if (slashOpen && slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((slashSel + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((slashSel - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
        e.preventDefault();
        runSlash(slashMatches[slashSel]);
        return;
      }
    }
    // `isComposing` guards against IME (Korean/Japanese/Chinese) — pressing
    // Enter to commit a composing character must not submit, or the last
    // character gets duplicated.
    if (isEnterSubmit({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
      e.preventDefault();
      void send();
    }
  };

  const openOptions = () => chrome.runtime.openOptionsPage();
  // Key-rejected state: land the user directly on the Gateway tab (quick connect).
  const openOptionsGateway = () =>
    void chrome.tabs.create({ url: chrome.runtime.getURL("src/options/index.html#gateway") });

  return (
    <div className="app">
      {/* Top row: online status + settings-related controls. UI language is set
          in the options page (Hermes Agent Chrome — Settings). */}
      <div className="topbar">
        <span
          className={`status ${health}`}
          title={health === "auth" ? undefined : t(lang, "statusTitle")}
          data-tip={health === "auth" ? t(lang, "status.authTip") : undefined}
          onClick={health === "auth" ? openOptionsGateway : undefined}
          role={health === "auth" ? "button" : undefined}
        >
          {health === "online"
            ? t(lang, "online")
            : health === "auth"
              ? t(lang, "status.auth")
              : health === "offline"
                ? t(lang, "offline")
                : "…"}
        </span>
        {/* Icon buttons use data-tip (instant CSS tooltip on hover) instead of
            the slow, easy-to-miss native title; aria-label keeps them readable. */}
        <button
          className="icon-btn theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          data-tip={theme === "dark" ? t(lang, "toLight") : t(lang, "toDark")}
          aria-label={theme === "dark" ? t(lang, "toLight") : t(lang, "toDark")}
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>
        <button
          className={`icon-btn home${view === "chat" ? " active" : ""}`}
          onClick={() => setView("chat")}
          data-tip={t(lang, "home")}
          aria-label={t(lang, "home")}
        >
          🏠
        </button>
        <button
          className={`icon-btn market${view === "market" ? " active" : ""}`}
          onClick={() => setView((v) => (v === "market" ? "chat" : "market"))}
          data-tip={t(lang, "marketTitle")}
          aria-label={t(lang, "marketTitle")}
        >
          📈
        </button>
        <button
          className={`icon-btn bookmarks${view === "bookmarks" ? " active" : ""}`}
          onClick={() => setView((v) => (v === "bookmarks" ? "chat" : "bookmarks"))}
          data-tip={view === "bookmarks" ? t(lang, "backToChat") : t(lang, "bookmarksTitle")}
          aria-label={view === "bookmarks" ? t(lang, "backToChat") : t(lang, "bookmarksTitle")}
        >
          🔖
        </button>
        {/* Always shown: when no Hive server is configured the tab renders an
            onboarding card instead of the feed (spec: hive-easy-setup). */}
        <button
          className={`icon-btn hive${view === "hive" ? " active" : ""}`}
          onClick={() => setView((v) => (v === "hive" ? "chat" : "hive"))}
          data-tip={view === "hive" ? t(lang, "backToChat") : t(lang, "hiveFeedTitle")}
          aria-label={view === "hive" ? t(lang, "backToChat") : t(lang, "hiveFeedTitle")}
        >
          🐝
        </button>
        <HiveSignIn lang={lang} />
        <button
          className="icon-btn settings"
          onClick={openOptions}
          data-tip={t(lang, "settings")}
          aria-label={t(lang, "settings")}
        >
          ⚙
        </button>
      </div>

      {/* Second row: page translation controls. */}
      <div className="translate-bar">
        <span className="tx-label">{t(lang, "translateTo")}</span>
        <select
          className="tx-lang"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          disabled={translateBusy}
          title={t(lang, "translateLangTitle")}
        >
          <option>English</option>
          <option>Korean</option>
          <option>Japanese</option>
          <option>Chinese</option>
          <option>Spanish</option>
          <option>French</option>
          <option>German</option>
        </select>
        <span className="tx-actions">
          {translateBusy ? (
            <button className="tx-go" onClick={() => translateAbortRef.current?.abort()} title={t(lang, "stop")}>
              {t(lang, "stop")}
            </button>
          ) : (
            <button className="tx-go" onClick={() => void runTranslate()} disabled={!config} title={t(lang, "translateTitle")}>
              {t(lang, "translate")}
            </button>
          )}
          <button
            className="tx-restore secondary"
            onClick={() => void runRestore()}
            disabled={translateBusy}
            title={t(lang, "restoreTitle")}
          >
            {t(lang, "restore")}
          </button>
        </span>
      </div>
      {(translateProgress || translateError) && (
        <div className={`tx-status ${translateError ? "err" : ""}`}>
          {translateError
            ? `⚠ ${translateError}`
            : translateProgress
              ? `${translateProgress.done} / ${translateProgress.total} chunks`
              : ""}
        </div>
      )}

      {view === "hive" ? (
        <Suspense fallback={<div className="bm-status">…</div>}>
          <HiveFeedView config={config} lang={lang} />
        </Suspense>
      ) : view === "bookmarks" ? (
        <Suspense fallback={<div className="bm-status">…</div>}>
          <BookmarksView config={config} lang={lang} />
        </Suspense>
      ) : view === "market" ? (
        <Suspense fallback={<div className="mr-status">…</div>}>
          <MarketReportView config={config} lang={lang} onReport={appendReport} />
        </Suspense>
      ) : (
        <>
      <div className="skills-bar">
        {PROMPT_SKILLS.map((s) => (
          <button
            key={s.id}
            className="skill"
            title={t(lang, `skill.${s.id}.title`)}
            disabled={!config || streaming}
            onClick={() => void runPromptSkill(s)}
          >
            {t(lang, `skill.${s.id}`)}
          </button>
        ))}
        <button className="skill" title={t(lang, "skill.links.title")} disabled={streaming} onClick={() => void runLocalSkill()}>
          {t(lang, "skill.links")}
        </button>
      </div>

      <div className="messages" ref={listRef}>
        {messages.map((m, idx) => {
          const isLast = idx === messages.length - 1;
          const latestProgress =
            m.toolProgress && m.toolProgress.length > 0
              ? m.toolProgress[m.toolProgress.length - 1]
              : "";
          return (
            <div key={m.id} className={`bubble ${m.role}${m.error ? " error" : ""}`}>
              {m.error ? (
                m.errorAction === "reconnect" ? (
                  <div className="err-action">
                    <span>{m.error}</span>
                    <button className="err-action-btn" onClick={openOptionsGateway}>
                      {t(lang, "err.401.fix")}
                    </button>
                  </div>
                ) : (
                  m.error
                )
              ) : m.role === "assistant" ? (
                m.content ? (
                  streaming && isLast ? (
                    // Stream as plain text (cheap); format to Markdown once done.
                    <div className="md md-stream">{m.content}</div>
                  ) : (
                    <MarkdownView text={m.content} />
                  )
                ) : streaming && isLast ? (
                  // One-line progress: latest agent/skill step, or a working pulse.
                  <div className="tool-progress working">{latestProgress || t(lang, "working")}</div>
                ) : (
                  ""
                )
              ) : (
                m.content ?? ""
              )}
            </div>
          );
        })}
      </div>

      {slashOpen && slashMatches.length > 0 && (
        <div className="slash-menu" role="listbox" aria-label={t(lang, "slash.title")}>
          {slashMatches.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={i === slashSel}
              className={`slash-item${i === slashSel ? " active" : ""}`}
              onMouseEnter={() => setSlashIdx(i)}
              onClick={() => runSlash(c)}
            >
              <span className="slash-cmd">/{c.name}</span>
              <span className="slash-label">{c.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="input-row">
        {/* New chat lives next to the message box — it acts on the conversation,
            not on app-level views, so it belongs with the composer. */}
        <button
          className="icon-btn new-chat"
          onClick={newChat}
          disabled={messages.length === 0 && !streaming}
          data-tip={t(lang, "newChatTitle")}
          aria-label={t(lang, "newChatTitle")}
        >
          ✎
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSlashIdx(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t(lang, "slashHint")}
          rows={1}
          disabled={streaming || !config}
        />
        {streaming ? (
          <button className="stop" onClick={stop}>{t(lang, "stop")}</button>
        ) : (
          <button className="send" onClick={() => void send()} disabled={!config || !input.trim()}>{t(lang, "send")}</button>
        )}
      </div>
        </>
      )}
    </div>
  );
}
