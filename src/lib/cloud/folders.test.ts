import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { publishFolder } from "./folders";
import type { PublishFolderInput } from "./types";

/** PocketBase fake covering the collections publishFolder touches. */
function fakePb(opts: { existingFolderId?: string; userId?: string | null } = {}) {
  const calls: {
    createdFolder: unknown;
    updatedFolder: unknown;
    deletedItemIds: string[];
    createdItems: unknown[];
  } = { createdFolder: null, updatedFolder: null, deletedItemIds: [], createdItems: [] };

  const pb = mockPb(
    {
      shared_folders: {
        getFirstListItem: vi.fn(async () => {
          if (opts.existingFolderId) return { id: opts.existingFolderId };
          throw { status: 404 };
        }),
        create: vi.fn(async (data: unknown) => {
          calls.createdFolder = data;
          return { id: "folder-1" };
        }),
        update: vi.fn(async (id: string, data: unknown) => {
          calls.updatedFolder = data;
          return { id };
        }),
      },
      shared_items: {
        getFullList: vi.fn(async () => [{ id: "old-item" }]),
        delete: vi.fn(async (id: string) => {
          calls.deletedItemIds.push(id);
          return true;
        }),
        create: vi.fn(async (row: unknown) => {
          calls.createdItems.push(row);
          return row;
        }),
      },
    },
    opts.userId === undefined ? "user-1" : opts.userId,
  );
  return { pb, calls };
}

const input: PublishFolderInput = {
  title: "AI papers",
  sourceFolderName: "AI",
  summary: "A folder about AI.",
  topics: ["ai", "ml"],
  items: [{ title: "Attention", url: "https://x/attention", itemSummary: "transformers" }],
};

describe("publishFolder", () => {
  it("creates the folder with the owner id when none exists", async () => {
    const { pb, calls } = fakePb();
    const { folderId } = await publishFolder(pb, input);
    expect(folderId).toBe("folder-1");
    expect(calls.createdFolder).toMatchObject({
      owner_id: "user-1",
      source_folder_name: "AI",
      title: "AI papers",
      topics: ["ai", "ml"],
      item_count: 1,
    });
  });

  it("updates in place when re-sharing the same source folder", async () => {
    const { pb, calls } = fakePb({ existingFolderId: "folder-7" });
    const { folderId } = await publishFolder(pb, input);
    expect(folderId).toBe("folder-7");
    expect(calls.updatedFolder).toMatchObject({ title: "AI papers" });
    expect(calls.createdFolder).toBeNull();
  });

  it("replaces items: deletes existing then inserts the new set", async () => {
    const { pb, calls } = fakePb();
    await publishFolder(pb, input);
    expect(calls.deletedItemIds).toEqual(["old-item"]);
    expect(calls.createdItems).toEqual([
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
    const { pb } = fakePb({ userId: null });
    await expect(publishFolder(pb, input)).rejects.toThrow(/signed in/i);
  });
});
