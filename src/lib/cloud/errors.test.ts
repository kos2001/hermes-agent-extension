import { describe, expect, it } from "vitest";
import { isUnreachable } from "./errors";

/** Shape of a PocketBase SDK ClientResponseError, minus the noise. */
function pbError(status: number, message: string, isAbort = false) {
  return { name: `ClientResponseError ${status}`, status, message, isAbort, response: {} };
}

describe("isUnreachable", () => {
  it("flags the status-0 error the SDK builds when fetch never got a response", () => {
    // Verified against pocketbase@0.x in a browser: an unreachable host yields
    // exactly this — status 0 and the SDK's generic fallback text.
    expect(isUnreachable(pbError(0, "Something went wrong."))).toBe(true);
  });

  it("leaves real HTTP responses alone — they carry a usable message", () => {
    expect(isUnreachable(pbError(404, "Missing collection context."))).toBe(false);
    expect(isUnreachable(pbError(403, "Only superusers can perform this action."))).toBe(false);
    expect(isUnreachable(pbError(400, "Failed to authenticate."))).toBe(false);
  });

  it("does not flag an aborted request — that is a cancel, not an outage", () => {
    expect(isUnreachable(pbError(0, "The request was aborted…", true))).toBe(false);
  });

  it("ignores non-PocketBase throwables", () => {
    expect(isUnreachable(new Error("boom"))).toBe(false);
    expect(isUnreachable(null)).toBe(false);
    expect(isUnreachable("nope")).toBe(false);
    expect(isUnreachable({ status: "0" })).toBe(false);
  });
});
