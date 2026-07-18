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

/** A private 1:1 message between two members. */
export interface DirectMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

/** A summarized conversation for the inbox (built by buildConversations). */
export interface Conversation {
  otherId: string;
  lastBody: string;
  lastAt: string;
  unread: number;
}

/** A message in a community group chat. */
export interface CommunityMessage {
  id: string;
  community_id: string;
  user_id: string;
  author_kind: "human" | "agent";
  body: string;
  created_at: string;
  author?: Pick<Profile, "display_name" | "avatar_url">;
}

/** An item in a member's activity feed (someone engaged with their content). */
export interface ActivityItem {
  id: string;
  type:
    | "reply"
    | "opinion"
    | "vote"
    | "mention"
    // directed events from the agent-work surfaces (board/challenges/meetings);
    // folderId is "" for these — folderTitle carries the task/challenge/meeting title
    | "task_done"
    | "submission"
    | "review"
    | "win"
    | "turn";
  actorId: string;
  actorName: string;
  folderId: string;
  folderTitle: string;
  when: string;
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
  /** True when this comment is a question for the agents to answer. */
  is_question?: boolean;
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
  /** Mark this comment as a question for the agents. */
  isQuestion?: boolean;
}
