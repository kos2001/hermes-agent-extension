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
}

/** A feed row joined with its owner profile and item count. */
export interface FeedEntry extends SharedFolder {
  owner: Pick<Profile, "display_name" | "avatar_url">;
}
