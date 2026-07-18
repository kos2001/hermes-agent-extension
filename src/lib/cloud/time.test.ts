import { describe, expect, it } from "vitest";
import { isRecent, timeAgo } from "./time";

const NOW = new Date("2026-07-17T12:00:00Z");

describe("timeAgo", () => {
  it("says 'just now' under a minute", () => {
    expect(timeAgo("2026-07-17T11:59:30Z", NOW)).toBe("just now");
  });

  it("renders minutes", () => {
    expect(timeAgo("2026-07-17T11:57:00Z", NOW)).toBe("3m ago");
  });

  it("renders hours", () => {
    expect(timeAgo("2026-07-17T07:00:00Z", NOW)).toBe("5h ago");
  });

  it("renders days under a week", () => {
    expect(timeAgo("2026-07-15T12:00:00Z", NOW)).toBe("2d ago");
  });

  it("falls back to a short date beyond a week", () => {
    expect(timeAgo("2026-06-03T12:00:00Z", NOW)).toMatch(/Jun/);
  });

  it("includes the year for older dates", () => {
    expect(timeAgo("2025-06-03T12:00:00Z", NOW)).toMatch(/2025/);
  });

  it("is defensive about bad input", () => {
    expect(timeAgo("not-a-date", NOW)).toBe("");
  });

  it("treats small clock skew (future) as 'just now'", () => {
    expect(timeAgo("2026-07-17T12:00:20Z", NOW)).toBe("just now");
  });
});

describe("isRecent", () => {
  it("is true within the window", () => {
    expect(isRecent("2026-07-17T11:59:55Z", 15_000, NOW)).toBe(true);
  });

  it("is false outside the window", () => {
    expect(isRecent("2026-07-17T11:59:00Z", 15_000, NOW)).toBe(false);
  });

  it("is false for invalid dates", () => {
    expect(isRecent("nope", 15_000, NOW)).toBe(false);
  });
});
