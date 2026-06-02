export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface SharedFolder {
  id: string;
  owner_id: string;
  title: string;
  source_folder_name: string;
  summary: string | null;
  topics: string[];
  item_count: number;
  created_at: string;
  updated_at: string;
  /** Community this folder is posted into, or null. */
  community_id: string | null;
}

/** A topic group folders can be posted into and members can join. */
export interface Community {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  folder_count: number;
  member_count: number;
}

export interface SharedItem {
  id: string;
  folder_id: string;
  title: string;
  url: string;
  item_summary: string | null;
  position: number;
}

/** Payload the extension hands to publishFolder (sub-project B fills this). */
export interface PublishFolderInput {
  title: string;
  sourceFolderName: string;
  summary: string;
  topics: string[];
  items: { title: string; url: string; itemSummary?: string }[];
  /** Optional community to post the folder into. */
  communityId?: string | null;
}

/** A feed row joined with its owner profile and item count. */
export interface FeedEntry extends SharedFolder {
  owner: Pick<Profile, "display_name" | "avatar_url">;
}

export type AuthorKind = "human" | "agent";

/** An opinion/comment on a shared folder, by a human or an AI agent. */
export interface Comment {
  id: string;
  folder_id: string;
  user_id: string;
  author_kind: AuthorKind;
  author_label: string | null;
  body: string;
  created_at: string;
  /** Parent comment id when this is a reply; null for a top-level opinion. */
  parent_id: string | null;
  /** Joined poster profile (when listed with the join). */
  author?: Pick<Profile, "display_name" | "avatar_url">;
}

/** A top-level opinion with its direct replies (built by threadComments). */
export interface CommentThread extends Comment {
  replies: Comment[];
}

/** What the client provides to post a comment (user_id comes from the session). */
export interface CommentInput {
  body: string;
  kind?: AuthorKind;
  label?: string;
  /** Set to reply to an existing comment. */
  parentId?: string;
}
