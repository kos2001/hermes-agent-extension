import { describe, expect, it } from "vitest";
import { buildSelectionMessages, detectScript, isAbbreviation, isSameLanguage } from "./selection-actions";

describe("isAbbreviation", () => {
  it("flags all-caps / caps+digit / dotted forms", () => {
    for (const t of ["API", "FDE", "MV3", "H2O", "e.g.", "i.e."]) expect(isAbbreviation(t)).toBe(true);
  });
  it("does not flag ordinary words, capitalized words, or multi-word text", () => {
    for (const t of ["Apple", "html", "hello", "New York", "the API spec"]) expect(isAbbreviation(t)).toBe(false);
  });
});

describe("output language for summarize/explain/rephrase", () => {
  it("forces the chosen output language into non-translate actions", () => {
    for (const action of ["summary", "explain", "rephrase"] as const) {
      const [system] = buildSelectionMessages(action, "some text", "Korean");
      expect(system.content).toContain("Write your entire response in Korean");
    }
  });
  it("does not append the output-language line to translate (it targets the language directly)", () => {
    const [system] = buildSelectionMessages("translate", "hi", "Korean");
    expect(system.content).not.toContain("Write your entire response in");
    expect(system.content).toContain("Korean");
  });
});

describe("explain prompt", () => {
  it("uses surrounding context and an ask-if-unsure instruction for an abbreviation", () => {
    const [system] = buildSelectionMessages("explain", "FDE", "English", "A Forward Deployed Engineer (FDE) embeds with the customer.");
    expect(system.content).toContain("FDE");
    expect(system.content).toContain("Forward Deployed Engineer");
    expect(system.content.toLowerCase()).toContain("ask the user");
  });
  it("falls back to the plain explanation without context or for non-abbreviations", () => {
    const [a] = buildSelectionMessages("explain", "FDE", "English");
    expect(a.content).not.toContain("Surrounding text");
    const [b] = buildSelectionMessages("explain", "the whole sentence here", "English", "ctx");
    expect(b.content).not.toContain("Surrounding text");
  });
});

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
