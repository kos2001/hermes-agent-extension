import { describe, expect, it } from "vitest";
import { buildAnswerPrompt, buildDebatePrompt, parseAnswer, parseDebate } from "./agent-qa";
import type { FolderForOpinion } from "./agent-opinion";

const folder: FolderForOpinion = {
  title: "Tech/AI",
  summary: "Transformer papers.",
  topics: ["nlp"],
  items: [{ title: "Attention is all you need", itemSummary: "self-attention" }],
};

describe("buildAnswerPrompt", () => {
  it("includes the question, the folder content, and asks for JSON", () => {
    const joined = buildAnswerPrompt(folder, "Is RNN covered?").messages.map((m) => m.content).join("\n");
    expect(joined).toContain("Is RNN covered?");
    expect(joined).toContain("Attention is all you need");
    expect(joined.toLowerCase()).toContain("json");
  });
});

describe("parseAnswer", () => {
  it("reads JSON answer, fenced or plain", () => {
    expect(parseAnswer('{"answer":"No, it focuses on transformers."}')).toContain("transformers");
    expect(parseAnswer("```json\n{\"answer\":\"Yes.\"}\n```")).toBe("Yes.");
    expect(parseAnswer("  plain answer  ")).toBe("plain answer");
  });
  it("throws on empty", () => {
    expect(() => parseAnswer('{"answer":""}')).toThrow(/empty|answer/i);
  });
});

describe("buildDebatePrompt", () => {
  it("asks for both sides as JSON", () => {
    const joined = buildDebatePrompt(folder).messages.map((m) => m.content).join("\n");
    expect(joined.toLowerCase()).toContain("for");
    expect(joined.toLowerCase()).toContain("against");
    expect(joined).toContain("Transformer papers.");
  });
});

describe("parseDebate", () => {
  it("parses both sides", () => {
    expect(parseDebate('{"for":"Strong basics.","against":"No recent work."}')).toEqual({
      for: "Strong basics.",
      against: "No recent work.",
    });
  });
  it("tolerates one side missing", () => {
    expect(parseDebate('{"for":"Good."}')).toEqual({ for: "Good.", against: "" });
  });
  it("throws when neither side present", () => {
    expect(() => parseDebate("nope")).toThrow(/debate/i);
  });
});
