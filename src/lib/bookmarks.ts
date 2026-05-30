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
