import { describe, expect, it } from "vitest";
import { buildSelectionMessages, detectScript, isSameLanguage } from "./selection-actions";

describe("detectScript", () => {
  it("detects Korean (Hangul)", () => {
    expect(detectScript("안녕하세요")).toBe("ko");
  });
  it("detects Japanese by kana even with kanji present", () => {
    expect(detectScript("これは日本語です")).toBe("ja");
  });
  it("detects Chinese (Han without kana)", () => {
    expect(detectScript("这是中文")).toBe("zh");
  });
  it("detects Latin", () => {
    expect(detectScript("Hello world")).toBe("latin");
  });
  it("returns 'other' for digits/symbols only", () => {
    expect(detectScript("123 — 456")).toBe("other");
  });
});

describe("isSameLanguage", () => {
  it("is true when CJK text matches the CJK target", () => {
    expect(isSameLanguage("안녕하세요", "Korean")).toBe(true);
    expect(isSameLanguage("これは日本語", "Japanese")).toBe(true);
    expect(isSameLanguage("这是中文", "Chinese")).toBe(true);
  });
  it("is false when CJK text differs from the CJK target", () => {
    expect(isSameLanguage("안녕하세요", "Japanese")).toBe(false);
    expect(isSameLanguage("Hello", "Korean")).toBe(false);
  });
  it("is always false for Latin targets (script can't disambiguate)", () => {
    expect(isSameLanguage("Hello world", "English")).toBe(false);
    expect(isSameLanguage("Hola mundo", "Spanish")).toBe(false);
  });
  it("is false for an unknown target language", () => {
    expect(isSameLanguage("안녕", "Klingon")).toBe(false);
  });
});

describe("translate prompt", () => {
  it("instructs the model to leave same-language text unchanged", () => {
    const [system] = buildSelectionMessages("translate", "hi", "English");
    expect(system.content).toContain("ALREADY written in English");
  });
});
