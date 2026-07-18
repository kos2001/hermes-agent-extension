// End-to-end check: load the built extension (dist/) in Chrome for Testing
// (branded Chrome 137+ ignores --load-extension; CfT keeps it), configure the
// local hermes api_server connection, and run a real streaming chat from the
// side panel. Run from a scratch dir with playwright-core installed:
//   npm i playwright-core && node ext-e2e.mjs
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DIST = process.env.EXT_DIST ?? path.join(os.homedir(), "gitspace/slsi-chrome/dist");
const EXPECTED_ID = "pdfafjabbbgidnmkcdmjpoapmdpemkil"; // pinned via manifest `key`

// Newest Chrome for Testing in Playwright's cache.
const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const chromiumDir = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const EXEC = path.join(cache, chromiumDir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

// Token the quick-connect flow uses (api_server block of ~/.hermes/config.yaml).
const TOKEN = execSync(
  `awk '/^api_server:/{f=1} f&&/token:/{print $2; exit}' ~/.hermes/config.yaml`,
  { shell: "/bin/zsh" },
).toString().trim();

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ext-e2e-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: EXEC,
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run"],
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const extId = new URL(sw.url()).host;
console.log(extId === EXPECTED_ID ? "extension id ✓" : `extension id MISMATCH: ${extId}`);

const page = await ctx.newPage();
await page.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
await page.evaluate(async (token) => {
  await chrome.storage.local.set({
    "hermes.config": { baseUrl: "http://127.0.0.1:8642", apiKey: token, model: "hermes-agent", headers: {} },
  });
}, TOKEN);
await page.reload();

await page.waitForSelector(".status.online", { timeout: 20000 })
  .then(() => console.log("health: ONLINE ✓"))
  .catch(() => console.log("health: still offline ✗ (is hermes on 8642 up?)"));

await page.fill("textarea", "ping — reply with the word pong only");
await page.click(".input-row button.send");
try {
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll(".bubble.assistant")].pop();
    return b && /pong/i.test(b.textContent || "") && !document.querySelector(".input-row .stop");
  }, { timeout: 120000 });
  console.log("chat reply ✓");
} catch {
  const last = await page.evaluate(() =>
    ([...document.querySelectorAll(".bubble")].pop()?.textContent || "(no bubble)").slice(0, 300));
  console.log("chat FAILED ✗ — last bubble:", JSON.stringify(last));
}

await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
