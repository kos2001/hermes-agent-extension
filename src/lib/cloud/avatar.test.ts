import { describe, expect, it } from "vitest";
import { avatarFor } from "./avatar";

describe("avatarFor", () => {
  it("is deterministic for the same seed", () => {
    expect(avatarFor("user-1").bg).toBe(avatarFor("user-1").bg);
  });

  it("usually differs for different seeds", () => {
    expect(avatarFor("user-1").bg).not.toBe(avatarFor("user-2").bg);
  });

  it("takes the initial from the label, uppercased", () => {
    expect(avatarFor("id-123", "ada").initial).toBe("A");
  });

  it("falls back to seed for the initial, and '?' when empty", () => {
    expect(avatarFor("zebra").initial).toBe("Z");
    expect(avatarFor("", "").initial).toBe("?");
  });

  it("returns an hsl color", () => {
    expect(avatarFor("x").bg).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
  });
});
