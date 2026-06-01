import { describe, expect, it } from "vitest";
import { rankContributors, type Contributor } from "./leaderboard";

function c(over: Partial<Contributor>): Contributor {
  return {
    user_id: "u",
    display_name: "n",
    avatar_url: null,
    opinions: 0,
    votes_received: 0,
    folders_shared: 0,
    ...over,
  };
}

describe("rankContributors", () => {
  it("sorts by votes, then opinions, then folders", () => {
    const ranked = rankContributors([
      c({ user_id: "a", votes_received: 1, opinions: 5 }),
      c({ user_id: "b", votes_received: 3 }),
      c({ user_id: "c", votes_received: 1, opinions: 9 }),
    ]);
    expect(ranked.map((r) => r.user_id)).toEqual(["b", "c", "a"]);
  });

  it("drops contributors with no activity at all", () => {
    const ranked = rankContributors([
      c({ user_id: "idle", votes_received: 0, opinions: 0, folders_shared: 0 }),
      c({ user_id: "sharer", folders_shared: 2 }),
    ]);
    expect(ranked.map((r) => r.user_id)).toEqual(["sharer"]);
  });

  it("keeps a folder-sharer with zero votes", () => {
    const ranked = rankContributors([c({ user_id: "s", folders_shared: 1 })]);
    expect(ranked).toHaveLength(1);
  });

  it("breaks exact ties by display name", () => {
    const ranked = rankContributors([
      c({ user_id: "z", display_name: "Zoe", votes_received: 2 }),
      c({ user_id: "a", display_name: "Ada", votes_received: 2 }),
    ]);
    expect(ranked.map((r) => r.display_name)).toEqual(["Ada", "Zoe"]);
  });
});
