import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Hermes Agent",
  version: pkg.version,
  description: pkg.description,
  action: {
    default_title: "Hermes Agent",
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "128": "icons/icon-128.png",
    },
  },
  icons: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "128": "icons/icon-128.png",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/selection-toolbar.ts"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  permissions: ["storage", "sidePanel", "activeTab", "scripting", "tabs", "bookmarks", "alarms", "notifications", "downloads", "identity"],
  // Broad host access granted at install so the side panel can read page
  // content and run page translation on any site (chrome.scripting / chrome.tabs)
  // without a separate runtime "grant access" step. Covers the openrouter /
  // localhost API hosts too.
  host_permissions: ["http://*/*", "https://*/*"],
});
