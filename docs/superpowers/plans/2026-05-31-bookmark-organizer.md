# Bookmark Organizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a side-panel "Bookmarks" view that tidies Chrome bookmarks via four operations (AI auto-categorize, remove duplicates, remove dead links, sort), each behind a preview-then-confirm gate.

**Architecture:** Pure logic + `chrome.bookmarks` wrappers live in `src/lib/bookmarks.ts`; a dedicated `BookmarksView.tsx` renders operation buttons → a checkbox preview of proposed `Action`s → Apply. `App.tsx` gains a `view` toggle (chat ↔ bookmarks) reached from a top-bar 🔖 button. AI categorize reuses the existing chat client via a new `collectChat` helper.

**Tech Stack:** TypeScript, React 18, Vite + @crxjs, Chrome MV3 (`chrome.bookmarks`), Vitest (node env, pure-logic tests only).

---

## File Structure

- `src/lib/bookmarks.ts` — **create** — types (`BookmarkNode`, `Action`), pure logic (`normalizeUrl`, `findDuplicates`, `planSort`, `buildCategorizePrompt`, `parseCategorization`), chrome wrappers (`loadBookmarks`, `applyActions`), network (`checkDeadLinks`).
- `src/lib/bookmarks.test.ts` — **create** — node unit tests for the pure functions.
- `src/lib/hermes-client.ts` — **modify** — add `collectChat` (accumulate a stream to a string).
- `src/lib/i18n.ts` — **modify** — add bookmark UI strings (ko/en/zh).
- `src/sidepanel/BookmarksView.tsx` — **create** — the dedicated view.
- `src/sidepanel/App.tsx` — **modify** — `view` state, 🔖 toggle button, conditional render.
- `src/sidepanel/styles.css` — **modify** — styles for the bookmarks view.
- `manifest.config.ts` — **modify** — add `"bookmarks"` permission.

Convention: pure functions are unit-tested in node; `chrome.*` wrappers, `fetch` code, and React components are verified manually by loading the unpacked extension (matches the existing repo — no jsdom / chrome mocks installed).

---

## Task 1: Bookmark types + `normalizeUrl`

**Files:**
- Create: `src/lib/bookmarks.ts`
- Test: `src/lib/bookmarks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/bookmarks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./bookmarks";

describe("normalizeUrl", () => {
  it("lowercases protocol and host but not the path", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/path");
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://a.com/x#section")).toBe("https://a.com/x");
  });

  it("strips a trailing slash except on the root", () => {
    expect(normalizeUrl("https://a.com/x/")).toBe("https://a.com/x");
    expect(normalizeUrl("https://a.com/")).toBe("https://a.com/");
  });

  it("treats a lone '?' as no query", () => {
    expect(normalizeUrl("https://a.com/x?")).toBe("https://a.com/x");
  });

  it("falls back to a trimmed lowercase string for non-URLs", () => {
    expect(normalizeUrl("  Not A URL ")).toBe("not a url");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookmarks.test.ts`
Expected: FAIL — "Failed to load url ./bookmarks" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/bookmarks.ts`:

```ts
import type { ChatMessage } from "./types";

/** A flattened bookmark or folder from `chrome.bookmarks.getTree()`. */
export interface BookmarkNode {
  id: string;
  title: string;
  /** Present for bookmarks, absent for folders. */
  url?: string;
  parentId?: string;
  /** Title of the containing folder (for display + "already there" checks). */
  parentTitle?: string;
  dateAdded: number;
  index: number;
}

/** A proposed change, rendered in the preview and consumed by `applyActions`. */
export type Action =
  | { id: string; kind: "remove"; bmId: string; title: string; url: string; reason: "duplicate" | "dead" }
  | { id: string; kind: "move"; bmId: string; title: string; url: string; toFolderPath: string }
  | { id: string; kind: "reorder"; folderId: string; folderTitle: string; orderedIds: string[]; count: number };

/**
 * Canonical form of a URL for duplicate detection: lowercase protocol+host,
 * no fragment, no trailing slash (except root), lone "?" dropped. Non-URLs
 * fall back to a trimmed lowercase string.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const search = u.search === "?" ? "" : u.search;
    return `${u.protocol}//${u.host}${path}${search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookmarks.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookmarks.ts src/lib/bookmarks.test.ts
git commit -m "feat(bookmarks): add BookmarkNode/Action types and normalizeUrl"
```

---

## Task 2: `findDuplicates`

**Files:**
- Modify: `src/lib/bookmarks.ts`
- Test: `src/lib/bookmarks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/bookmarks.test.ts`:

```ts
import { findDuplicates } from "./bookmarks";

function bm(id: string, url: string | undefined, dateAdded: number, extra: Partial<import("./bookmarks").BookmarkNode> = {}) {
  return { id, title: id, url, dateAdded, index: 0, parentId: "1", parentTitle: "Bar", ...extra };
}

describe("findDuplicates", () => {
  it("keeps the oldest and removes the rest", () => {
    const nodes = [
      bm("a", "https://x.com/", 100),
      bm("b", "https://x.com", 200),
      bm("c", "https://x.com/#frag", 300),
    ];
    const actions = findDuplicates(nodes);
    expect(actions.map((a) => a.id).sort()).toEqual(["remove-b", "remove-c"]);
    expect(actions.every((a) => a.kind === "remove" && a.reason === "duplicate")).toBe(true);
  });

  it("ignores folders and unique URLs", () => {
    const nodes = [
      bm("folder", undefined, 1),
      bm("a", "https://x.com/", 100),
      bm("b", "https://y.com/", 200),
    ];
    expect(findDuplicates(nodes)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookmarks.test.ts`
Expected: FAIL — "findDuplicates is not a function" / no export.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/bookmarks.ts`:

```ts
/** Group by normalized URL; keep the oldest, propose removing the rest. */
export function findDuplicates(nodes: BookmarkNode[]): Action[] {
  const groups = new Map<string, BookmarkNode[]>();
  for (const n of nodes) {
    if (!n.url) continue;
    const key = normalizeUrl(n.url);
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }
  const actions: Action[] = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    const oldestFirst = [...arr].sort((a, b) => a.dateAdded - b.dateAdded);
    for (const dup of oldestFirst.slice(1)) {
      actions.push({
        id: `remove-${dup.id}`,
        kind: "remove",
        bmId: dup.id,
        title: dup.title,
        url: dup.url as string,
        reason: "duplicate",
      });
    }
  }
  return actions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookmarks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookmarks.ts src/lib/bookmarks.test.ts
git commit -m "feat(bookmarks): findDuplicates (keep oldest)"
```

---

## Task 3: `planSort`

**Files:**
- Modify: `src/lib/bookmarks.ts`
- Test: `src/lib/bookmarks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/bookmarks.test.ts`:

```ts
import { planSort } from "./bookmarks";

describe("planSort", () => {
  it("emits a reorder action only for folders whose order changes", () => {
    const nodes = [
      bm("b", "https://b.com/", 200, { index: 0, parentId: "f1", parentTitle: "F1" }),
      bm("a", "https://a.com/", 100, { index: 1, parentId: "f1", parentTitle: "F1" }),
      bm("c", "https://c.com/", 300, { index: 0, parentId: "f2", parentTitle: "F2" }),
    ];
    const byName = planSort(nodes, "name");
    expect(byName).toHaveLength(1);
    expect(byName[0]).toMatchObject({ kind: "reorder", folderId: "f1", orderedIds: ["a", "b"], count: 2 });
  });

  it("sorts by date added", () => {
    const nodes = [
      bm("late", "https://l.com/", 999, { index: 0, parentId: "f1", parentTitle: "F1" }),
      bm("early", "https://e.com/", 1, { index: 1, parentId: "f1", parentTitle: "F1" }),
    ];
    const byDate = planSort(nodes, "date");
    expect(byDate[0].kind).toBe("reorder");
    expect((byDate[0] as { orderedIds: string[] }).orderedIds).toEqual(["early", "late"]);
  });

  it("returns nothing when already sorted", () => {
    const nodes = [
      bm("a", "https://a.com/", 100, { index: 0, parentId: "f1", parentTitle: "F1" }),
      bm("b", "https://b.com/", 200, { index: 1, parentId: "f1", parentTitle: "F1" }),
    ];
    expect(planSort(nodes, "name")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookmarks.test.ts`
Expected: FAIL — "planSort is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/bookmarks.ts`:

```ts
/** Per folder, propose reordering bookmarks by name or date (only if changed). */
export function planSort(nodes: BookmarkNode[], key: "name" | "date"): Action[] {
  const byFolder = new Map<string, BookmarkNode[]>();
  for (const n of nodes) {
    if (!n.url || !n.parentId) continue;
    const arr = byFolder.get(n.parentId);
    if (arr) arr.push(n);
    else byFolder.set(n.parentId, [n]);
  }
  const actions: Action[] = [];
  for (const [folderId, arr] of byFolder) {
    const current = [...arr].sort((a, b) => a.index - b.index);
    const sorted = [...current].sort((a, b) =>
      key === "name" ? a.title.localeCompare(b.title) : a.dateAdded - b.dateAdded,
    );
    const currentIds = current.map((n) => n.id);
    const sortedIds = sorted.map((n) => n.id);
    if (currentIds.join(" ") === sortedIds.join(" ")) continue;
    actions.push({
      id: `reorder-${folderId}`,
      kind: "reorder",
      folderId,
      folderTitle: current[0]?.parentTitle ?? folderId,
      orderedIds: sortedIds,
      count: sortedIds.length,
    });
  }
  return actions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookmarks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookmarks.ts src/lib/bookmarks.test.ts
git commit -m "feat(bookmarks): planSort by name/date (changed folders only)"
```

---

## Task 4: `buildCategorizePrompt` + `parseCategorization`

**Files:**
- Modify: `src/lib/bookmarks.ts`
- Test: `src/lib/bookmarks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/bookmarks.test.ts`:

```ts
import { buildCategorizePrompt, parseCategorization } from "./bookmarks";

describe("buildCategorizePrompt", () => {
  it("sends only bookmarks, capped at 300, and reports the skipped count", () => {
    const nodes = Array.from({ length: 305 }, (_, i) => bm(`b${i}`, `https://s${i}.com/`, i));
    nodes.push(bm("folder", undefined, 1));
    const { messages, sent, skipped } = buildCategorizePrompt(nodes);
    expect(sent).toBe(300);
    expect(skipped).toBe(5);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });
});

describe("parseCategorization", () => {
  const nodes = [
    bm("a", "https://a.com/", 1, { parentTitle: "Bar" }),
    bm("b", "https://b.com/", 2, { parentTitle: "News" }),
  ];

  it("parses an assignments object into move actions", () => {
    const text = '{"assignments": {"a": "News", "b": "News"}}';
    const actions = parseCategorization(text, nodes);
    // "a" moves to News; "b" already in News -> skipped
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "move-a", kind: "move", toFolderPath: "News" });
  });

  it("extracts JSON from a fenced code block", () => {
    const text = "Here you go:\n```json\n{\"assignments\":{\"a\":\"Dev\"}}\n```";
    expect(parseCategorization(text, nodes)).toHaveLength(1);
  });

  it("ignores unknown ids and returns [] for garbage", () => {
    expect(parseCategorization('{"assignments":{"zzz":"X"}}', nodes)).toEqual([]);
    expect(parseCategorization("not json at all", nodes)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/bookmarks.test.ts`
Expected: FAIL — "buildCategorizePrompt is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/bookmarks.ts`:

```ts
/** Max bookmarks sent to the model per categorize request (token bound). */
export const MAX_CATEGORIZE = 300;

/** Build the LLM request for categorization. Returns the sent/skipped counts. */
export function buildCategorizePrompt(
  nodes: BookmarkNode[],
): { messages: ChatMessage[]; sent: number; skipped: number } {
  const all = nodes.filter((n) => n.url);
  const picked = all.slice(0, MAX_CATEGORIZE);
  const list = picked.map((n) => ({ id: n.id, title: n.title, url: n.url }));
  const system =
    "You organize browser bookmarks into topic folders. Given a JSON array of " +
    'bookmarks ({id, title, url}), reply with a JSON object {"assignments": ' +
    '{"<bookmark id>": "<Folder Name>"}}. Use a small set of clear, single-level ' +
    "folder names (no nesting, no slashes). Every input id must appear exactly " +
    "once. Reply with JSON only.";
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(list) },
    ],
    sent: picked.length,
    skipped: all.length - picked.length,
  };
}

/** First balanced-ish `{...}` JSON object found in `text` (handles fences). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Turn a model categorization response into `move` actions. */
export function parseCategorization(text: string, nodes: BookmarkNode[]): Action[] {
  const obj = extractJsonObject(text);
  if (!obj) return [];
  const raw = (obj.assignments ?? obj) as unknown;
  if (!raw || typeof raw !== "object") return [];
  const assignments = raw as Record<string, unknown>;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const actions: Action[] = [];
  for (const [bmId, folder] of Object.entries(assignments)) {
    if (typeof folder !== "string" || !folder.trim()) continue;
    const node = byId.get(bmId);
    if (!node || !node.url) continue;
    const target = folder.trim();
    if ((node.parentTitle ?? "") === target) continue;
    actions.push({ id: `move-${bmId}`, kind: "move", bmId, title: node.title, url: node.url, toFolderPath: target });
  }
  return actions;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/bookmarks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bookmarks.ts src/lib/bookmarks.test.ts
git commit -m "feat(bookmarks): categorize prompt builder + response parser"
```

---

## Task 5: chrome wrappers (`loadBookmarks`, `applyActions`) + manifest permission

No unit test (requires the `chrome.bookmarks` API). Verified by type-check now and manually in Task 11.

**Files:**
- Modify: `src/lib/bookmarks.ts`
- Modify: `manifest.config.ts:38`

- [ ] **Step 1: Add the `bookmarks` permission**

In `manifest.config.ts`, change the `permissions` line (currently line 38):

```ts
  permissions: ["storage", "sidePanel", "activeTab", "scripting", "tabs", "bookmarks"],
```

- [ ] **Step 2: Implement `loadBookmarks` and `applyActions`**

Append to `src/lib/bookmarks.ts`:

```ts
/** Flatten `chrome.bookmarks.getTree()` into a list (bookmarks + folders). */
export async function loadBookmarks(): Promise<BookmarkNode[]> {
  const tree = await chrome.bookmarks.getTree();
  const out: BookmarkNode[] = [];
  const walk = (node: chrome.bookmarks.BookmarkTreeNode, parentTitle: string) => {
    out.push({
      id: node.id,
      title: node.title,
      url: node.url,
      parentId: node.parentId,
      parentTitle,
      dateAdded: node.dateAdded ?? 0,
      index: node.index ?? 0,
    });
    if (node.children) for (const c of node.children) walk(c, node.title || parentTitle);
  };
  for (const root of tree) {
    if (root.children) for (const c of root.children) walk(c, root.title);
  }
  return out;
}

/** Find or create a single-level topic folder under the bookmarks bar (id "1"). */
async function ensureFolder(title: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(title);
  if (cached) return cached;
  const found = (await chrome.bookmarks.search({ title })).find((n) => !n.url);
  const id = found ? found.id : (await chrome.bookmarks.create({ parentId: "1", title })).id;
  cache.set(title, id);
  return id;
}

/** Execute approved actions. Per-action try/catch so one failure isn't fatal. */
export async function applyActions(actions: Action[]): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  const folderCache = new Map<string, string>();
  for (const action of actions) {
    try {
      if (action.kind === "remove") {
        await chrome.bookmarks.remove(action.bmId);
      } else if (action.kind === "reorder") {
        for (let i = 0; i < action.orderedIds.length; i++) {
          await chrome.bookmarks.move(action.orderedIds[i], { parentId: action.folderId, index: i });
        }
      } else {
        const folderId = await ensureFolder(action.toFolderPath, folderCache);
        await chrome.bookmarks.move(action.bmId, { parentId: folderId });
      }
      applied++;
    } catch {
      failed++;
    }
  }
  return { applied, failed };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`@types/chrome` provides `chrome.bookmarks`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/bookmarks.ts manifest.config.ts
git commit -m "feat(bookmarks): loadBookmarks + applyActions; add bookmarks permission"
```

---

## Task 6: `checkDeadLinks` (network)

No unit test (network + `fetch`). Verified manually in Task 11.

**Files:**
- Modify: `src/lib/bookmarks.ts`

- [ ] **Step 1: Implement `checkDeadLinks`**

Append to `src/lib/bookmarks.ts`:

```ts
export interface DeadLinkOpts {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Fetch each http(s) bookmark and flag dead ones (status >= 400 or network
 * failure). Concurrency-limited, abortable, 8s per-URL timeout. Individual
 * failures never abort the whole run. A user abort is NOT counted as dead.
 */
export async function checkDeadLinks(nodes: BookmarkNode[], opts: DeadLinkOpts = {}): Promise<Action[]> {
  const concurrency = opts.concurrency ?? 6;
  const targets = nodes.filter((n) => n.url && /^https?:/i.test(n.url));
  const total = targets.length;
  let done = 0;
  const actions: Action[] = [];

  const isDead = async (n: BookmarkNode): Promise<boolean> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(n.url as string, { method: "GET", signal: ctrl.signal, redirect: "follow" });
      return res.status >= 400;
    } catch {
      return !opts.signal?.aborted;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  };

  let i = 0;
  const worker = async () => {
    while (i < targets.length && !opts.signal?.aborted) {
      const n = targets[i++];
      const dead = await isDead(n);
      if (dead && !opts.signal?.aborted) {
        actions.push({ id: `remove-${n.id}`, kind: "remove", bmId: n.id, title: n.title, url: n.url as string, reason: "dead" });
      }
      done++;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return actions;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/bookmarks.ts
git commit -m "feat(bookmarks): checkDeadLinks (concurrent, abortable)"
```

---

## Task 7: `collectChat` helper

No unit test (wraps `fetch`-based `streamChat`; the repo mocks no network). Verified by the AI categorize path in Task 11.

**Files:**
- Modify: `src/lib/hermes-client.ts` (append after `streamChat`, end of file)

- [ ] **Step 1: Implement `collectChat`**

Append to `src/lib/hermes-client.ts`:

```ts
/**
 * Non-streaming convenience: run a chat request and return the full text.
 * Accumulates `streamChat` deltas; rejects with HermesError on stream error.
 */
export async function collectChat(req: StreamChatRequest): Promise<string> {
  let acc = "";
  let error: string | null = null;
  await streamChat(req, {
    onChunk: (d) => {
      acc += d;
    },
    onError: (m) => {
      error = m;
    },
  });
  if (error) throw new HermesError(error);
  return acc;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hermes-client.ts
git commit -m "feat(client): add collectChat (accumulate stream to string)"
```

---

## Task 8: i18n strings

**Files:**
- Modify: `src/lib/i18n.ts` (inside the `STR` object)

- [ ] **Step 1: Add the bookmark strings**

In `src/lib/i18n.ts`, add these entries to the `STR` object (e.g. right after the `newChatTitle` entry):

```ts
  // Bookmarks organizer
  bookmarks: { ko: "북마크", en: "Bookmarks", zh: "书签" },
  bookmarksTitle: { ko: "즐겨찾기 정리", en: "Organize bookmarks", zh: "整理书签" },
  backToChat: { ko: "채팅으로", en: "Back to chat", zh: "返回聊天" },
  "bm.dedup": { ko: "중복 제거", en: "Duplicates", zh: "去重" },
  "bm.dead": { ko: "깨진 링크", en: "Dead links", zh: "失效链接" },
  "bm.sortName": { ko: "이름순 정렬", en: "Sort by name", zh: "按名称排序" },
  "bm.sortDate": { ko: "날짜순 정렬", en: "Sort by date", zh: "按日期排序" },
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(i18n): bookmark organizer strings (ko/en/zh)"
```

---

## Task 9: `BookmarksView` component + styles

No unit test (React component; repo has no jsdom). Verified manually in Task 11.

**Files:**
- Create: `src/sidepanel/BookmarksView.tsx`
- Modify: `src/sidepanel/styles.css` (append at end)

- [ ] **Step 1: Create the component**

Create `src/sidepanel/BookmarksView.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { collectChat } from "@/lib/hermes-client";
import {
  type Action,
  type BookmarkNode,
  applyActions,
  buildCategorizePrompt,
  checkDeadLinks,
  findDuplicates,
  loadBookmarks,
  parseCategorization,
  planSort,
} from "@/lib/bookmarks";

/** null = idle. "dead"/"ai" = a long op running. "apply" = applying changes. */
type Busy = null | "dead" | "ai" | "apply";

function describe(a: Action, lang: Lang): string {
  if (a.kind === "remove") {
    const why = a.reason === "duplicate" ? t(lang, "bm.tagDup") : t(lang, "bm.tagDead");
    return `🗑 [${why}] ${a.title || a.url}`;
  }
  if (a.kind === "move") return `📁 ${a.toFolderPath} ← ${a.title || a.url}`;
  return `↕ ${a.folderTitle} (${a.count})`;
}

export default function BookmarksView({
  config,
  lang,
}: {
  config: ConnectionConfig | null;
  lang: Lang;
}) {
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const deadAbort = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    setNodes(await loadBookmarks());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setResult = useCallback((next: Action[], noteMsg = "") => {
    setActions(next);
    setChecked(new Set(next.map((a) => a.id)));
    setNote(noteMsg);
    setError("");
  }, []);

  const runDedup = useCallback(() => setResult(findDuplicates(nodes)), [nodes, setResult]);
  const runSort = useCallback((key: "name" | "date") => setResult(planSort(nodes, key)), [nodes, setResult]);

  const runDead = useCallback(async () => {
    setResult([]);
    setBusy("dead");
    setProgress({ done: 0, total: 0 });
    const ctrl = new AbortController();
    deadAbort.current = ctrl;
    try {
      const result = await checkDeadLinks(nodes, {
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(result);
    } finally {
      deadAbort.current = null;
      setBusy(null);
      setProgress(null);
    }
  }, [nodes, setResult]);

  const runAi = useCallback(async () => {
    if (!config) {
      setError(t(lang, "bm.needConfig"));
      return;
    }
    setResult([]);
    setBusy("ai");
    try {
      const { messages, skipped } = buildCategorizePrompt(nodes);
      const text = await collectChat({ config, messages, responseFormat: { type: "json_object" } });
      const result = parseCategorization(text, nodes);
      if (result.length === 0) {
        setError(t(lang, "bm.aiNoResult"));
      } else {
        setResult(result, skipped > 0 ? t(lang, "bm.aiSkipped").replace("{n}", String(skipped)) : "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [config, nodes, lang, setResult]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = useCallback(async () => {
    const selected = actions.filter((a) => checked.has(a.id));
    if (selected.length === 0) return;
    const removals = selected.filter((a) => a.kind === "remove").length;
    if (removals > 0 && !window.confirm(t(lang, "bm.confirmRemove").replace("{n}", String(removals)))) return;
    setBusy("apply");
    try {
      const { applied, failed } = await applyActions(selected);
      setActions([]);
      setChecked(new Set());
      setNote(t(lang, "bm.applied").replace("{a}", String(applied)).replace("{f}", String(failed)));
      await reload();
    } finally {
      setBusy(null);
    }
  }, [actions, checked, lang, reload]);

  const disabled = busy !== null;

  return (
    <div className="bm-view">
      <div className="bm-actions">
        <button className="skill" onClick={runDedup} disabled={disabled}>{t(lang, "bm.dedup")}</button>
        <button className="skill" onClick={() => void runDead()} disabled={disabled}>{t(lang, "bm.dead")}</button>
        <button className="skill" onClick={() => runSort("name")} disabled={disabled}>{t(lang, "bm.sortName")}</button>
        <button className="skill" onClick={() => runSort("date")} disabled={disabled}>{t(lang, "bm.sortDate")}</button>
        <button className="skill" onClick={() => void runAi()} disabled={disabled || !config}>{t(lang, "bm.ai")}</button>
      </div>

      {busy === "dead" && progress && (
        <div className="bm-status">
          {progress.done} / {progress.total}
          <button className="tx-restore" onClick={() => deadAbort.current?.abort()}>{t(lang, "stop")}</button>
        </div>
      )}
      {(busy === "ai" || busy === "apply") && <div className="bm-status">{t(lang, "working")}</div>}
      {error && <div className="bm-status err">⚠ {error}</div>}
      {note && <div className="bm-status">{note}</div>}

      <div className="bm-list">
        {actions.length === 0 && !disabled && <div className="bm-empty">{t(lang, "bm.empty")}</div>}
        {actions.map((a) => (
          <label key={a.id} className="bm-row">
            <input type="checkbox" checked={checked.has(a.id)} onChange={() => toggle(a.id)} />
            <span className="bm-row-main">{describe(a, lang)}</span>
          </label>
        ))}
      </div>

      {actions.length > 0 && (
        <div className="bm-apply">
          <span>{t(lang, "bm.selected").replace("{n}", String(checked.size))}</span>
          <button className="tx-go" onClick={() => void apply()} disabled={disabled || checked.size === 0}>
            {t(lang, "bm.apply")}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `src/sidepanel/styles.css`:

```css
/* Bookmarks organizer view */
.bm-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.bm-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--muted);
}
.bm-status.err { color: var(--error); }
.bm-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}
.bm-empty {
  padding: 24px 16px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.bm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.bm-row:hover { background: var(--panel-2); }
.bm-row-main {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bm-apply {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/BookmarksView.tsx src/sidepanel/styles.css
git commit -m "feat(bookmarks): BookmarksView component + styles"
```

---

## Task 10: Wire the view toggle into `App.tsx`

**Files:**
- Modify: `src/sidepanel/App.tsx`

- [ ] **Step 1: Import the view**

After the existing `import { isEnterSubmit } from "@/lib/keyboard";` line, add:

```tsx
import BookmarksView from "./BookmarksView";
```

- [ ] **Step 2: Add `view` state**

Immediately after the `const [input, setInput] = useState("");` line, add:

```tsx
  const [view, setView] = useState<"chat" | "bookmarks">("chat");
```

- [ ] **Step 3: Add the 🔖 toggle button to the top bar**

In the top bar, insert this button immediately BEFORE the existing new-chat button (`<button className="icon-btn new-chat" ...>`):

```tsx
        <button
          className={`icon-btn bookmarks${view === "bookmarks" ? " active" : ""}`}
          onClick={() => setView((v) => (v === "bookmarks" ? "chat" : "bookmarks"))}
          title={view === "bookmarks" ? t(lang, "backToChat") : t(lang, "bookmarksTitle")}
        >
          🔖
        </button>
```

- [ ] **Step 4: Conditionally render the bookmarks view**

Replace the chat body — the `skills-bar` block, the `messages` block, and the `input-row` block — so they only render in chat view, and render `BookmarksView` in bookmarks view. Wrap the existing three blocks like this:

Find the start (`<div className="skills-bar">`) and the end (the closing `</div>` of `input-row`). Wrap them:

```tsx
      {view === "bookmarks" ? (
        <BookmarksView config={config} lang={lang} />
      ) : (
        <>
          {/* existing skills-bar div ... */}
          {/* existing messages div ... */}
          {/* existing input-row div ... */}
        </>
      )}
```

Concretely: insert `{view === "bookmarks" ? (\n  <BookmarksView config={config} lang={lang} />\n) : (\n  <>` immediately before `<div className="skills-bar">`, and insert `</>\n)}` immediately after the `input-row`'s closing `</div>`. Do not change the inner JSX.

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: type-check clean; `✓ built`.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (existing 41 + new bookmarks tests).

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(bookmarks): top-bar toggle + render BookmarksView"
```

---

## Task 11: Manual verification (load the unpacked extension)

The `chrome.bookmarks` wrappers, dead-link fetches, and the React view have no
automated tests — verify them in a real browser.

> Per project memory: on Chrome 137+ the `--load-extension` CLI flag is ignored.
> Load the unpacked `dist/` via the Extensions page UI instead.

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: `dist/` produced, `manifest.json` lists `"bookmarks"` in permissions.

- [ ] **Step 2: Load `dist/` as an unpacked extension**

`chrome://extensions` → enable Developer mode → "Load unpacked" → select the
`dist/` folder. Open the side panel from the toolbar.

- [ ] **Step 3: Verify each operation against the preview-then-confirm gate**

  - [ ] Click 🔖 → the Bookmarks view replaces the chat; click again → returns to chat.
  - [ ] **Duplicates**: with two bookmarks of the same URL present, "중복 제거" lists the newer one with a 🗑 [duplicate] row; unchecking it and Apply leaves it; rechecking + Apply removes only it (oldest kept). Confirm dialog shows the removal count.
  - [ ] **Sort by name / date**: lists ↕ reorder rows only for folders that aren't already ordered; Apply reorders them in `chrome://bookmarks`.
  - [ ] **Dead links**: shows live progress `done / total` with a Stop button; Stop halts and adds no further rows; completed run lists only unreachable URLs as 🗑 [dead].
  - [ ] **AI categorize** (with a configured connection): shows a working state, then 📁 move rows; with no connection configured it shows the `bm.needConfig` message and does not call the network.
  - [ ] After any Apply, the summary "N applied, M failed" shows and the list reloads.

- [ ] **Step 4: Final clean build + tests**

Run: `npm run build && npx vitest run`
Expected: build OK, all tests pass.

This task has no commit (verification only). If a defect is found, return to the
relevant task, fix with a test where possible, and re-verify.

---

## Notes for the implementer

- **Run scoped tests** during pure-logic tasks: `npx vitest run src/lib/bookmarks.test.ts`.
- **The `chrome` global** is typed via `@types/chrome` (already a dev dep) — no import needed in `.ts`/`.tsx`.
- **Bookmarks bar id** is `"1"` in Chrome; new topic folders are created there.
- **Action `id`s are deterministic** (`remove-<bmId>`, `move-<bmId>`, `reorder-<folderId>`) — a bookmark yields at most one action per run, so they're unique within a result set.
- **Do not** add jsdom or testing-library; component/chrome/network code is verified manually per the repo convention.
