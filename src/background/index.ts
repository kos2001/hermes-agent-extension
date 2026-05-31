/**
 * MV3 service worker.
 *
 * Responsibilities are intentionally narrow — the UI (side panel) speaks
 * directly to Hermes over HTTP, which keeps streaming simple (no SW⇄UI relay
 * for SSE chunks). The SW only:
 *
 *  1) Opens the side panel when the toolbar action is clicked.
 *  2) Acts as an out-of-band health-check probe so the UI can show online
 *     status even if it is closed.
 */

import { checkHealth, streamChat } from "@/lib/hermes-client";
import {
  buildSelectionMessages,
  getTranslateTarget,
  SELECTION_PORT,
  type SelectionRequest,
  type SelectionResponse,
} from "@/lib/selection-actions";
import { loadConfig } from "@/lib/storage";
import { loadBookmarks } from "@/lib/bookmarks";
import { downloadReport, loadMarketSettings, MARKET_ALARM, runMarketReport, saveReport } from "@/lib/market-report";
import { isLang, LANG_KEY } from "@/lib/i18n";

/** Post a message to a port, ignoring failures from a closed port. */
function safePost(port: chrome.runtime.Port, msg: SelectionResponse): void {
  try {
    port.postMessage(msg);
  } catch {
    /* port disconnected mid-stream — nothing to do */
  }
}

/**
 * Selection-toolbar channel: the content script connects, sends one
 * {action, text} request, and we stream the model's response back as chunks.
 * A long-lived port (not sendMessage) lets the popup render tokens as they
 * arrive; disconnecting the port aborts the in-flight request.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SELECTION_PORT) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener((req: SelectionRequest) => {
    if (!req || typeof req.text !== "string") return;
    void (async () => {
      let settled = false;
      const finish = (msg: SelectionResponse) => {
        if (settled) return;
        settled = true;
        safePost(port, msg);
      };
      try {
        const cfg = await loadConfig();
        if (!cfg.apiKey) throw new Error("No API key configured — open extension options");
        const target = req.targetLang || (await getTranslateTarget());
        const messages = buildSelectionMessages(req.action, req.text, target);
        let produced = false;
        let lastError = "";
        await streamChat(
          { config: cfg, messages, signal: controller.signal },
          {
            onChunk: (delta) => {
              produced = true;
              safePost(port, { type: "chunk", delta });
            },
            // Forward Hermes agent/skill tool activity so the popup can show progress.
            onToolProgress: (line) => safePost(port, { type: "progress", line }),
            onError: (m) => {
              lastError = m;
            },
            onDone: () => finish({ type: "done" }),
          },
        );
        if (!produced && lastError) finish({ type: "error", message: lastError });
        else finish({ type: "done" });
      } catch (e) {
        if (controller.signal.aborted) return;
        finish({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("setPanelBehavior failed:", err));
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId === undefined) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
    console.warn("sidePanel.open failed:", err);
  });
});

type BgMessage = { type: "hermes/health" } | { type: "hermes/ping" };

chrome.runtime.onMessage.addListener((msg: BgMessage, _sender, sendResponse) => {
  if (msg?.type === "hermes/health") {
    (async () => {
      const cfg = await loadConfig();
      const ok = await checkHealth(cfg);
      sendResponse({ ok, baseUrl: cfg.baseUrl });
    })();
    return true; // async
  }
  if (msg?.type === "hermes/ping") {
    sendResponse({ ok: true, ts: Date.now() });
    return false;
  }
  return false;
});

/** Run the scheduled market report and notify on completion. */
async function runScheduledMarketReport(): Promise<void> {
  const settings = await loadMarketSettings();
  if (settings.freq === "off" || !settings.folderId) return;
  const config = await loadConfig();
  const nodes = await loadBookmarks();
  const folder = nodes.find((n) => n.id === settings.folderId && !n.url);
  const folderTitle = folder?.title || settings.folderId;
  // Match the report language to the user's selected UI language.
  const storedLang = (await chrome.storage.local.get(LANG_KEY))[LANG_KEY];
  const lang = isLang(storedLang) ? storedLang : "ko";
  const report = await runMarketReport({ nodes, folderId: settings.folderId, folderTitle, config, lang });
  await saveReport(report);
  if (settings.autoSave && report.synthesis) {
    try {
      await downloadReport(report, settings.saveFolder);
    } catch {
      /* download failed (e.g. no synthesis / permission) — keep the in-app report */
    }
  }
  const ok = report.sites.filter((s) => !s.error).length;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Market report ready",
    message: `${folderTitle}: ${ok}/${report.sites.length} sites summarized`,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MARKET_ALARM) void runScheduledMarketReport();
});
