import { describe, expect, it, vi } from "vitest";
import { publishFolder } from "./folders";
import type { PublishFolderInput } from "./types";

/** Minimal chainable fake of the Supabase query builder we use. */
function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: { upsertFolder: unknown; deletedItems: boolean; insertedItems: unknown } = {
    upsertFolder: null,
    deletedItems: false,
    insertedItems: null,
  };
  const folderRow = { id: "folder-1" };
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })) },
    from: vi.fn((table: string) => {
      if (table === "shared_folders") {
        return {
          upsert: vi.fn((row: unknown) => {
            calls.upsertFolder = row;
            return { select: () => ({ single: async () => ({ data: folderRow, error: null }) }) };
          }),
        };
      }
      if (table === "shared_items") {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(async () => {
              calls.deletedItems = true;
              return { error: null };
            }),
          })),
          insert: vi.fn(async (rows: unknown) => {
            calls.insertedItems = rows;
            return { error: null };
          }),
        };
      }
      throw new Error("unexpected table " + table);
    }),
    ...overrides,
  };
  return { client, calls };
}

const input: PublishFolderInput = {
  title: "AI papers",
  sourceFolderName: "AI",
  summary: "A folder about AI.",
  topics: ["ai", "ml"],
  items: [{ title: "Attention", url: "https://x/attention", itemSummary: "transformers" }],
};

describe("publishFolder", () => {
  it("upserts the folder keyed on owner+source name with the owner id", async () => {
    const { client, calls } = fakeClient();
    await publishFolder(client as never, input);
    expect(calls.upsertFolder).toMatchObject({
      owner_id: "user-1",
      source_folder_name: "AI",
      title: "AI papers",
      topics: ["ai", "ml"],
      item_count: 1,
    });
  });

  it("replaces items: deletes existing then inserts the new set", async () => {
    const { client, calls } = fakeClient();
    await publishFolder(client as never, input);
    expect(calls.deletedItems).toBe(true);
    expect(calls.insertedItems).toEqual([
      {
        folder_id: "folder-1",
        title: "Attention",
        url: "https://x/attention",
        item_summary: "transformers",
        position: 0,
      },
    ]);
  });

  it("throws when there is no signed-in user", async () => {
    const { client } = fakeClient({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    });
    await expect(publishFolder(client as never, input)).rejects.toThrow(/signed in/i);
  });
});
