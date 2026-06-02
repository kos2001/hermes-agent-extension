import { describe, expect, it } from "vitest";
import { buildOpinionPrompt, parseOpinion, type FolderForOpinion } from "./agent-opinion";

const folder: FolderForOpinion = {
  title: "Tech/AI",
  summary: "Foundational transformer papers.",
  topics: ["nlp", "transformers"],
  items: [
    { title: "Attention is all you need", itemSummary: "Introduces self-attention." },
    { title: "BERT", itemSummary: "Bidirectional pretraining." },
  ],
};

describe("buildOpinionPrompt", () => {
  it("includes the folder summary, items, and asks for a JSON opinion", () => {
    const { messages } = buildOpinionPrompt(folder, []);
    const joined = messages.map((m) => m.content).join("\n");
    expect(joined).toContain("Foundational transformer papers.");
    expect(joined).toContain("Attention is all you need");
    expect(joined.toLowerCase()).toContain("opinion");
    expect(joined.toLowerCase()).toContain("json");
  });

  it("includes prior opinions so the agent responds to the discussion", () => {
    const { messages } = buildOpinionPrompt(folder, [
      { label: "gpt", body: "Missing newer efficient-attention work." },
    ]);
    const joined = messages.map((m) => m.content).join("\n");
    expect(joined).toContain("Missing newer efficient-attention work.");
  });
});

describe("parseOpinion", () => {
  it("reads the opinion from JSON", () => {
    expect(parseOpinion('{"opinion": "Great starter set; add a survey paper."}')).toBe(
      "Great starter set; add a survey paper.",
    );
  });

  it("reads fenced JSON", () => {
    expect(parseOpinion('```json\n{"opinion":"Solid."}\n```')).toBe("Solid.");
  });

  it("falls back to trimmed plain text when not JSON", () => {
    expect(parseOpinion("  Just a plain opinion.  ")).toBe("Just a plain opinion.");
  });

  it("throws on empty content", () => {
    expect(() => parseOpinion("   ")).toThrow(/empty|opinion/i);
    expect(() => parseOpinion('{"opinion": ""}')).toThrow(/empty|opinion/i);
  });
});
