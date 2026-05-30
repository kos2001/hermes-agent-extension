import { describe, expect, it } from "vitest";
import { isEnterSubmit } from "./keyboard";

describe("isEnterSubmit", () => {
  it("submits on a plain Enter", () => {
    expect(isEnterSubmit({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
  });

  it("does not submit on Shift+Enter (newline)", () => {
    expect(isEnterSubmit({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
  });

  it("does not submit on other keys", () => {
    expect(isEnterSubmit({ key: "a", shiftKey: false, isComposing: false })).toBe(false);
  });

  // The bug: pressing Enter to commit an in-progress IME composition (e.g.
  // Korean/Japanese/Chinese) must NOT submit, otherwise the last character is
  // committed and then re-inserted, duplicating it.
  it("does not submit while an IME composition is in progress", () => {
    expect(isEnterSubmit({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });

  it("does not submit during composition reported via legacy keyCode 229", () => {
    expect(isEnterSubmit({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 })).toBe(
      false,
    );
  });
});
