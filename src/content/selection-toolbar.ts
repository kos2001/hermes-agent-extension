/**
 * Selection action toolbar — page-assist's "copilot" feature, adapted.
 *
 * On every page (where the user has granted host access) we watch the mouse
 * selection. When the user finishes dragging over a non-empty range, a small
 * floating toolbar appears beside it offering AI actions ported from
 * page-assist: Translate / Summarize / Explain / Rephrase. Picking one streams
 * the model's response inline, right where the text was selected — no need to
 * open the side panel.
 *
 * Communication boundary: the content script cannot reach the LLM directly
 * (host_permissions live on the extension, not the page). It opens a long-lived
 * port to the service worker, which runs the model and streams chunks back.
 */

import {
  SELECTION_ACTIONS,
  SELECTION_PORT,
  TRANSLATE_LANGUAGES,
  type SelectionActionKey,
  type SelectionResponse,
} from "@/lib/selection-actions";
import { renderMarkdown } from "@/lib/markdown";

const TARGET_KEY = "hermes.translateTarget";
let lastLang = "English";

const ROOT_ID = "__hermes_sel_root__";
const MIN_CHARS = 2;
const MAX_CHARS = 4000;
const TIMEOUT_MS = 60_000;

const log = (...args: unknown[]) => console.log("[hermes-sel]", ...args);
log("selection toolbar loaded", location.href);

// Scoped styles for markdown rendered inside the result panel. Injected once;
// high-specificity #id selectors keep page CSS from bleeding in.
const MD_STYLE_ID = "__hermes_sel_md_style__";
function ensureMarkdownStyles() {
  if (document.getElementById(MD_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MD_STYLE_ID;
  style.textContent = `
#${ROOT_ID} p { margin: 0 0 8px; }
#${ROOT_ID} p:last-child, #${ROOT_ID} *:last-child { margin-bottom: 0; }
#${ROOT_ID} h1, #${ROOT_ID} h2, #${ROOT_ID} h3,
#${ROOT_ID} h4, #${ROOT_ID} h5, #${ROOT_ID} h6 { margin: 8px 0 5px; font-size: 14px; line-height: 1.3; }
#${ROOT_ID} ul, #${ROOT_ID} ol { margin: 0 0 8px; padding-left: 20px; }
#${ROOT_ID} li { margin: 2px 0; }
#${ROOT_ID} a { color: #3a52c0; }
#${ROOT_ID} code { background: rgba(124,156,255,0.16); padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
#${ROOT_ID} pre { background: rgba(20,23,31,0.06); border: 1px solid rgba(124,156,255,0.25); padding: 9px 10px; border-radius: 7px; overflow-x: auto; margin: 0 0 8px; }
#${ROOT_ID} pre code { background: none; padding: 0; }
#${ROOT_ID} blockquote { margin: 0 0 8px; padding: 2px 10px; border-left: 3px solid rgba(124,156,255,0.5); color: #555; }
#${ROOT_ID} hr { border: 0; border-top: 1px solid rgba(124,156,255,0.3); margin: 9px 0; }
#${ROOT_ID} ul ul, #${ROOT_ID} ol ol, #${ROOT_ID} ul ol, #${ROOT_ID} ol ul { margin: 2px 0; }
#${ROOT_ID} table { border-collapse: collapse; margin: 0 0 8px; font-size: 12px; display: block; overflow-x: auto; }
#${ROOT_ID} th, #${ROOT_ID} td { border: 1px solid rgba(124,156,255,0.3); padding: 4px 8px; text-align: left; }
#${ROOT_ID} th { background: rgba(124,156,255,0.12); font-weight: 600; }
#${ROOT_ID} .hx-status { font-size: 12px; color: #6b7280; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${ROOT_ID} .hx-status.working { color: #4f63cf; animation: __hx_pulse 1.1s ease-in-out infinite; }
@keyframes __hx_pulse { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }
`;
  (document.head || document.documentElement).appendChild(style);
}

let enabled = true;
let root: HTMLDivElement | null = null;
let lastText = "";
let activePort: chrome.runtime.Port | null = null;

function teardownPort() {
  if (activePort) {
    try {
      activePort.disconnect();
    } catch {
      /* already gone */
    }
    activePort = null;
  }
}

function hide() {
  teardownPort();
  if (root) {
    root.remove();
    root = null;
  }
  lastText = "";
}

function positionRoot(el: HTMLDivElement, rect: DOMRect, width: number, estHeight: number) {
  const margin = 8;
  el.style.width = `${width}px`;

  const belowTop = rect.bottom + margin;
  const fitsBelow = belowTop + estHeight < window.innerHeight;
  if (fitsBelow) {
    el.style.top = `${belowTop}px`;
    el.style.transform = "";
  } else {
    el.style.top = `${rect.top - margin}px`;
    el.style.transform = "translateY(-100%)";
  }

  let left = rect.left;
  if (left + width > window.innerWidth - margin) {
    left = window.innerWidth - width - margin;
  }
  el.style.left = `${Math.max(margin, left)}px`;
}

const BASE_STYLE = [
  "position: fixed",
  "z-index: 2147483647",
  // Layered light background: a soft accent glow at the top-left fading into a
  // near-white vertical gradient — reads with more depth than a flat fill,
  // while the blur lets the page show through faintly (frosted glass).
  "background:" +
    " radial-gradient(120% 80% at 0% 0%, rgba(124,156,255,0.22), transparent 60%)," +
    " linear-gradient(160deg, #ffffff 0%, #eef1fb 100%)",
  "color: #232838",
  // Accent-tinted hairline border + bright inner top highlight for a glassy edge.
  "border: 1px solid rgba(124,156,255,0.45)",
  "border-radius: 10px",
  "backdrop-filter: blur(6px) saturate(135%)",
  "-webkit-backdrop-filter: blur(6px) saturate(135%)",
  "box-shadow: 0 8px 28px rgba(40,50,90,0.22), 0 0 0 1px rgba(124,156,255,0.10), inset 0 1px 0 rgba(255,255,255,0.75)",
  'font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  "pointer-events: auto",
  "user-select: none",
].join(";");

function createRoot(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = ROOT_ID;
  el.style.cssText = BASE_STYLE;
  el.setAttribute("data-hermes", "1");
  // Don't let clicks inside the toolbar collapse the page selection.
  el.addEventListener("mousedown", (e) => e.preventDefault());
  return el;
}

/** A pill button styled to match the toolbar; `onClick` runs on click. */
function makeChip(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.title = title;
  btn.style.cssText = [
    "all: unset",
    "cursor: pointer",
    "padding: 5px 11px",
    "border-radius: 6px",
    "color: #2a3146",
    "font: inherit",
    "white-space: nowrap",
    "transition: background 120ms ease, color 120ms ease",
  ].join(";");
  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(124,156,255,0.20)";
    btn.style.color = "#3a52c0";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "";
    btn.style.color = "#2a3146";
  });
  btn.addEventListener("click", onClick);
  return btn;
}

/** Render the action-button toolbar. */
function showToolbar(rect: DOMRect, text: string, context: string) {
  hide();
  const el = createRoot();
  el.style.padding = "4px";
  el.style.display = "flex";
  el.style.gap = "2px";

  for (const action of SELECTION_ACTIONS) {
    // Every action first asks which language to produce its result in.
    el.appendChild(
      makeChip(action.label, action.title, () =>
        showLanguageMenu(action.key, action.label, rect, text, context),
      ),
    );
  }

  const width = Math.min(SELECTION_ACTIONS.length * 70, window.innerWidth - 16);
  positionRoot(el, rect, width, 44);
  document.documentElement.appendChild(el);
  root = el;
  lastText = text;
}

/** Show the output-language picker for any action, then run it in that language. */
function showLanguageMenu(
  action: SelectionActionKey,
  actionLabel: string,
  rect: DOMRect,
  text: string,
  context: string,
) {
  hide();
  const el = createRoot();
  el.style.padding = "6px";

  const label = document.createElement("div");
  label.textContent = `${actionLabel} →`;
  label.style.cssText = [
    "font-size: 11px",
    "font-weight: 700",
    "letter-spacing: 0.04em",
    "color: #4f63cf",
    "padding: 2px 6px 6px",
  ].join(";");
  el.appendChild(label);

  const grid = document.createElement("div");
  grid.style.cssText = "display: flex; flex-wrap: wrap; gap: 2px; max-width: 320px;";
  // Most-recent language first for quick re-use.
  const langs = [lastLang, ...TRANSLATE_LANGUAGES.filter((l) => l !== lastLang)];
  for (const lang of langs) {
    grid.appendChild(
      makeChip(lang, `${actionLabel} → ${lang}`, () =>
        runAction(action, `${actionLabel} → ${lang}`, rect, text, lang, context),
      ),
    );
  }
  el.appendChild(grid);

  positionRoot(el, rect, Math.min(332, window.innerWidth - 16), 96);
  document.documentElement.appendChild(el);
  root = el;
  lastText = text;
}

/** Swap the toolbar for a streaming result panel and run the action. */
function runAction(
  action: SelectionActionKey,
  title: string,
  rect: DOMRect,
  text: string,
  targetLang?: string,
  context?: string,
) {
  hide();
  if (targetLang) {
    // Remember the chosen language for the menu's "most-recent" ordering. Only
    // Translate persists to the shared page-translate target (TARGET_KEY) — a
    // summary/explain/rephrase language choice shouldn't change that.
    lastLang = targetLang;
    if (action === "translate") void chrome.storage?.local?.set({ [TARGET_KEY]: targetLang });
  }
  ensureMarkdownStyles();
  const el = createRoot();
  el.style.padding = "10px 12px";

  const header = document.createElement("div");
  header.textContent = title;
  header.style.cssText = [
    "font-size: 11px",
    "font-weight: 700",
    "letter-spacing: 0.06em",
    "text-transform: uppercase",
    "color: #4f63cf",
    "margin-bottom: 6px",
  ].join(";");

  // One-line progress/status row: pulses while working, shows the latest
  // tool-progress line from the agent, hidden once the result starts.
  const status = document.createElement("div");
  status.className = "hx-status working";
  status.textContent = "● 작업 중…";

  const body = document.createElement("div");
  body.style.cssText = [
    "white-space: pre-wrap",
    "word-break: break-word",
    "user-select: text",
    "max-height: 320px",
    "overflow-y: auto",
  ].join(";");

  el.appendChild(header);
  el.appendChild(status);
  el.appendChild(body);
  // Widen the result window to fit the screen: ~60% of the viewport, with a
  // sensible minimum, never exceeding the available width (positionRoot keeps
  // it on-screen by shifting left when the selection is near the right edge).
  const width = Math.min(Math.max(420, Math.round(window.innerWidth * 0.6)), window.innerWidth - 16);
  positionRoot(el, rect, width, 140);
  document.documentElement.appendChild(el);
  root = el;
  lastText = text;

  streamInto(action, text, body, status, targetLang, context);
}

/** Open the port, send the request, and stream chunks into `body`. */
function streamInto(
  action: SelectionActionKey,
  text: string,
  body: HTMLDivElement,
  status: HTMLDivElement,
  targetLang?: string,
  context?: string,
) {
  let acc = "";
  let gotChunk = false;

  const port = chrome.runtime.connect({ name: SELECTION_PORT });
  activePort = port;

  const hideStatus = () => {
    status.style.display = "none";
  };

  // While streaming, paint the growing text as plain text (cheap, coalesced to
  // one update per frame). Markdown is parsed exactly once when the stream
  // settles — avoids the O(n²) of re-parsing the whole buffer on every token.
  let rafId = 0;
  let dirty = false;
  const flushRender = () => {
    rafId = 0;
    if (!dirty) return;
    dirty = false;
    body.textContent = acc;
  };
  const scheduleRender = () => {
    dirty = true;
    if (!rafId) rafId = requestAnimationFrame(flushRender);
  };

  const timeout = setTimeout(() => {
    if (activePort === port && !gotChunk) {
      hideStatus();
      body.textContent = "⚠ Timeout — the service worker did not respond in 60s";
      teardownPort();
    }
  }, TIMEOUT_MS);

  const settle = () => {
    clearTimeout(timeout);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (acc.trim()) body.innerHTML = renderMarkdown(acc); // commit final text
    hideStatus();
    if (activePort === port) activePort = null;
    try {
      port.disconnect();
    } catch {
      /* noop */
    }
  };

  port.onMessage.addListener((msg: SelectionResponse) => {
    if (activePort !== port) return; // stale (user moved on)
    if (msg.type === "progress") {
      // Show the latest agent/skill step on the one-line status row.
      status.classList.remove("working");
      status.textContent = msg.line;
    } else if (msg.type === "chunk") {
      gotChunk = true;
      hideStatus(); // result is arriving — drop the progress row
      acc += msg.delta;
      scheduleRender();
    } else if (msg.type === "error") {
      body.textContent = `⚠ ${msg.message}`;
      settle();
    } else if (msg.type === "done") {
      if (!acc.trim()) body.textContent = "(no response)";
      settle();
    }
  });

  port.onDisconnect.addListener(() => {
    clearTimeout(timeout);
    if (chrome.runtime.lastError && !gotChunk && activePort === port) {
      hideStatus();
      body.textContent = `⚠ ${chrome.runtime.lastError.message}`;
    }
  });

  log("dispatch", { action, len: text.length, targetLang });
  port.postMessage({ action, text, targetLang, context });
}

/** Surrounding text around the selection (for Explain to read context). */
const CONTEXT_CHARS = 240;
function captureContext(range: Range, selected: string): string {
  const node = range.commonAncestorContainer;
  const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null;
  const block = el?.closest("p, li, article, section, blockquote, td, div, main, body") ?? el;
  const full = (block?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!full) return "";
  const at = full.indexOf(selected.replace(/\s+/g, " ").trim());
  const start = at < 0 ? 0 : Math.max(0, at - CONTEXT_CHARS);
  const end = at < 0 ? Math.min(full.length, CONTEXT_CHARS * 2) : Math.min(full.length, at + selected.length + CONTEXT_CHARS);
  return full.slice(start, end);
}

function handleSelection() {
  if (!enabled) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return; // keep an open result panel alive
  const text = sel.toString().trim();
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) {
    hide();
    return;
  }
  if (text === lastText && root) return;
  let range: Range;
  let rect: DOMRect;
  try {
    range = sel.getRangeAt(0);
    rect = range.getBoundingClientRect();
  } catch {
    return;
  }
  showToolbar(rect, text, captureContext(range, text));
}

document.addEventListener("mouseup", () => {
  // Defer one tick so the selection is finalized.
  setTimeout(handleSelection, 10);
});

document.addEventListener("mousedown", (e) => {
  if (root && !root.contains(e.target as Node)) hide();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hide();
});

// Honor the on/off switch and seed the last-used target language at boot.
chrome.storage?.local
  ?.get(["hermes.selectionTranslateEnabled", TARGET_KEY])
  .then((r) => {
    if (r["hermes.selectionTranslateEnabled"] === false) {
      enabled = false;
      hide();
    }
    if (typeof r[TARGET_KEY] === "string") lastLang = r[TARGET_KEY];
  })
  .catch(() => {});

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes["hermes.selectionTranslateEnabled"]) {
    enabled = changes["hermes.selectionTranslateEnabled"].newValue !== false;
    if (!enabled) hide();
  }
  if (changes[TARGET_KEY] && typeof changes[TARGET_KEY].newValue === "string") {
    lastLang = changes[TARGET_KEY].newValue;
  }
});
