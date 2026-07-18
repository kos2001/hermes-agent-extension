import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Hermes Agent Chrome",
  version: pkg.version,
  description: pkg.description,
  // Pinned public key → a STABLE extension id (pdfafjabbbgidnmkcdmjpoapmdpemkil)
  // across all machines and load paths. This lets every user configure the
  // Hermes gateway's `cors_origins` with one fixed chrome-extension:// origin.
  // (Private key kept out of the repo; only needed to pack a signed .crx.)
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsx1bLIHxCsR8NLTe04KqVxguNcOpYmEC5+q3j+K6cOkHjP8dFxnRrWPhXeta23ijIqMIX/biGkWQ+hMeVFWw1nPvrUAdeMxeFDuN9qj3FAplNXKAmYHFH9r8eePXyP+dWiy9oH15gW1MZV0cfFUFjFbl76P5IWH5+Aa3BDcBo57CI/Zct4VFUjKKOYpMc62sQkmrNOq+oWXvBvJKOQAezB9ud3SuCXIFsMgYu+5BVdNaG1Z0W9SbAia4eiusrVYk248A602m+7L3CI5zCpuuC5wqCRayhfREenk64Jt0bRHX1wA9aqWZ7HmhPYngVT0rpBEPDPDYGGbixLk+ru8L9wIDAQAB",
  action: {
    default_title: "Hermes Agent Chrome",
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
  permissions: ["storage", "sidePanel", "activeTab", "scripting", "tabs", "bookmarks", "alarms", "notifications", "downloads"],
  // Broad host access granted at install so the side panel can read page
  // content and run page translation on any site (chrome.scripting / chrome.tabs)
  // without a separate runtime "grant access" step. Covers the openrouter /
  // localhost API hosts too.
  host_permissions: ["http://*/*", "https://*/*"],
});
