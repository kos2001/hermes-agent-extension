import type PocketBase from "pocketbase";
import type { Comment, CommentInput, CommentThread } from "./types";
import { eq, inList, uid } from "./pb";

/**
 * Nest comments one level: top-level opinions (no parent) each carry their
 * direct replies, in chronological order. Replies whose parent is missing are
 * promoted to top level so nothing is hidden.
 */
export function threadComments(comments: Comment[]): CommentThread[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const threads = new Map<string, CommentThread>();
  const order: string[] = [];
  for (const c of comments) {
    if (!c.parent_id || !byId.has(c.parent_id)) {
      threads.set(c.id, { ...c, replies: [] });
      order.push(c.id);
    }
  }
  for (const c of comments) {
    if (c.parent_id && threads.has(c.parent_id)) {
      threads.get(c.parent_id)!.replies.push(c);
    }
  }
  return order.map((id) => threads.get(id)!);
}

/** A folder's opinion thread, oldest first, each joined with its poster. */
export async function listComments(pb: PocketBase, folderId: string): Promise<Comment[]> {
  const rows = await pb.collection("comments").getFullList({
    filter: eq("folder_id", folderId),
    sort: "created_at",
    expand: "user_id",
  });
  return rows.map((row) => {
    const { expand, ...c } = row as Record<string, unknown> & {
      expand?: { user_id?: { display_name: string | null; avatar_url: string | null } };
    };
    return {
      ...c,
      parent_id: (c.parent_id as string | null) || null,
      author: {
        display_name: expand?.user_id?.display_name ?? null,
        avatar_url: expand?.user_id?.avatar_url ?? null,
      },
    } as Comment;
  });
}

/** Post an opinion/comment on a folder as the current user; returns the new id. */
export async function postComment(
  pb: PocketBase,
  folderId: string,
  input: CommentInput,
): Promise<string> {
  const body = input.body.trim();
  if (!body) throw new Error("Comment body is empty");

  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to comment");

  const created = await pb.collection("comments").create({
    folder_id: folderId,
    user_id: userId,
    author_kind: input.kind ?? "human",
    author_label: input.label ?? null,
    body,
    parent_id: input.parentId ?? null,
    is_question: input.isQuestion ?? false,
  });
  return created.id;
}

/** Number of comments per folder id (for feed badges). */
export async function commentCounts(
  pb: PocketBase,
  folderIds: string[],
): Promise<Record<string, number>> {
  if (folderIds.length === 0) return {};
  const rows = await pb.collection("comments").getFullList({
    filter: inList("folder_id", folderIds),
    fields: "folder_id",
  });
  const counts: Record<string, number> = {};
  for (const row of rows as unknown as { folder_id: string }[]) {
    counts[row.folder_id] = (counts[row.folder_id] ?? 0) + 1;
  }
  return counts;
}
