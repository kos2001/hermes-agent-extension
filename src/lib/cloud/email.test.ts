import { describe, expect, it } from "vitest";
import { isValidEmail } from "./email";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("oseok.kim2001@gmail.com")).toBe(true);
    expect(isValidEmail("  trimmed@x.io  ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "a", "a@", "@b.com", "a@b", "a b@c.com", "a@b .com"]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});
