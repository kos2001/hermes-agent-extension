import { describe, expect, it } from "vitest";
import { buildFolderSummaryPrompt, parseFolderSummary, type FolderItem } from "./summarize-folder";

const items: FolderItem[] = [
  { title: "Attention is all you need", url: "https://arxiv.org/abs/1706.03762" },
  { title: "BERT", url: "https://arxiv.org/abs/1810.04805" },
];

describe("buildFolderSummaryPrompt", () => {
  it("includes the folder path and the items, and asks for JSON only", () => {
    const { messages, sent } = buildFolderSummaryPrompt("Tech/AI", items);
    expect(sent).toBe(2);
    const joined = messages.map((m) => m.content).join("\n");
    expect(joined).toContain("Tech/AI");
    expect(joined).toContain("https://arxiv.org/abs/1706.03762");
    expect(joined.toLowerCase()).toContain("json");
  });

  it("caps the number of items sent", () => {
    const many: FolderItem[] = Array.from({ length: 100 }, (_, i) => ({
      title: `t${i}`,
      url: `https://x/${i}`,
    }));
    const { sent } = buildFolderSummaryPrompt("Big", many);
    expect(sent).toBeLessThanOrEqual(60);
  });
});

describe("parseFolderSummary", () => {
  it("parses fenced JSON into summary/topics/items", () => {
    const text =
      "```json\n" +
      JSON.stringify({
        summary: "Foundational NLP transformer papers.",
        topics: ["NLP", "transformers", "deep learning"],
        items: [
          { url: "https://arxiv.org/abs/1706.03762", summary: "The original transformer." },
          { url: "https://arxiv.org/abs/1810.04805", summary: "Bidirectional pretraining." },
        ],
      }) +
      "\n```";
    const out = parseFolderSummary(text, items);
    expect(out.summary).toContain("transformer");
    expect(out.topics).toEqual(["nlp", "transformers", "deep learning"]);
    expect(out.items).toEqual([
      {
        title: "Attention is all you need",
        url: "https://arxiv.org/abs/1706.03762",
        itemSummary: "The original transformer.",
      },
      {
        title: "BERT",
        url: "https://arxiv.org/abs/1810.04805",
        itemSummary: "Bidirectional pretraining.",
      },
    ]);
  });

  it("falls back to the item title when the model omits an item summary", () => {
    const text = JSON.stringify({ summary: "s", topics: [], items: [] });
    const out = parseFolderSummary(text, items);
    expect(out.items[0].itemSummary).toBe("Attention is all you need");
    expect(out.items).toHaveLength(2);
  });

  it("dedups and lowercases topics and caps them", () => {
    const topics = ["AI", "ai", "ML", "ml", "a", "b", "c", "d", "e", "f", "g", "h"];
    const text = JSON.stringify({ summary: "s", topics, items: [] });
    const out = parseFolderSummary(text, items);
    expect(out.topics).toContain("ai");
    expect(new Set(out.topics).size).toBe(out.topics.length);
    expect(out.topics.length).toBeLessThanOrEqual(8);
  });

  it("throws on input with no JSON object", () => {
    expect(() => parseFolderSummary("sorry, I cannot do that", items)).toThrow(/no .*summary|parse/i);
  });
});
