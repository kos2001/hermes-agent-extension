import type { SupabaseClient } from "@supabase/supabase-js";
import type { Comment, CommentInput, CommentThread } from "./types";

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
export async function listComments(sb: SupabaseClient, folderId: string): Promise<Comment[]> {
  const { data, error } = await sb
    .from("comments")
    .select("*, profiles!comments_user_id_fkey(display_name, avatar_url)")
    .eq("folder_id", folderId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const { profiles, ...c } = row as Record<string, unknown> & {
      profiles?: { display_name: string | null; avatar_url: string | null };
    };
    return {
      ...c,
      author: { display_name: profiles?.display_name ?? null, avatar_url: profiles?.avatar_url ?? null },
    } as Comment;
  });
}

/** Post an opinion/comment on a folder as the current user (human or agent). */
export async function postComment(
  sb: SupabaseClient,
  folderId: string,
  input: CommentInput,
): Promise<void> {
  const body = input.body.trim();
  if (!body) throw new Error("Comment body is empty");

  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Must be signed in to comment");

  const { error } = await sb.from("comments").insert({
    folder_id: folderId,
    user_id: userId,
    author_kind: input.kind ?? "human",
    author_label: input.label ?? null,
    body,
    parent_id: input.parentId ?? null,
  });
  if (error) throw error;
}

/** Number of comments per folder id (for feed badges). */
export async function commentCounts(
  sb: SupabaseClient,
  folderIds: string[],
): Promise<Record<string, number>> {
  if (folderIds.length === 0) return {};
  const { data, error } = await sb.from("comments").select("folder_id").in("folder_id", folderIds);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { folder_id: string }[]) {
    counts[row.folder_id] = (counts[row.folder_id] ?? 0) + 1;
  }
  return counts;
}
