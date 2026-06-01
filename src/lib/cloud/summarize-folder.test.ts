import { describe, expect, it } from "vitest";
import {
  CONTENT_CHARS,
  buildFolderInsightPrompt,
  parseFolderSummary,
  type FolderItem,
  type ItemWithContent,
} from "./summarize-folder";

const withContent: ItemWithContent[] = [
  {
    title: "Attention is all you need",
    url: "https://arxiv.org/abs/1706.03762",
    content: "The dominant sequence transduction models... we propose the Transformer, based solely on self-attention.",
  },
  {
    title: "BERT",
    url: "https://arxiv.org/abs/1810.04805",
    content: "BERT pre-trains deep bidirectional representations from unlabeled text.",
  },
];

const items: FolderItem[] = withContent.map((i) => ({ title: i.title, url: i.url }));

describe("buildFolderInsightPrompt", () => {
  it("includes the folder path, each page's CONTENT, and asks for insight + JSON", () => {
    const { messages, sent } = buildFolderInsightPrompt("Tech/AI", withContent);
    expect(sent).toBe(2);
    const joined = messages.map((m) => m.content).join("\n");
    expect(joined).toContain("Tech/AI");
    expect(joined).toContain("self-attention"); // actual page content, not just title/url
    expect(joined.toLowerCase()).toContain("insight");
    expect(joined.toLowerCase()).toContain("json");
  });

  it("caps the page content length per item", () => {
    const big: ItemWithContent[] = [{ title: "t", url: "https://x/1", content: "a".repeat(10000) }];
    const { messages } = buildFolderInsightPrompt("F", big);
    const user = messages[1].content;
    expect(user).toContain("a".repeat(CONTENT_CHARS));
    expect(user).not.toContain("a".repeat(CONTENT_CHARS + 1));
  });
});

describe("parseFolderSummary", () => {
  it("parses fenced JSON, mapping each item's insight by url", () => {
    const text =
      "```json\n" +
      JSON.stringify({
        summary: "Foundational NLP transformer papers.",
        topics: ["NLP", "transformers"],
        items: [
          { url: "https://arxiv.org/abs/1706.03762", insight: "Introduces self-attention; removes recurrence entirely." },
          { url: "https://arxiv.org/abs/1810.04805", insight: "Bidirectional pretraining sets a new transfer-learning baseline." },
        ],
      }) +
      "\n```";
    const out = parseFolderSummary(text, items);
    expect(out.summary).toContain("transformer");
    expect(out.topics).toEqual(["nlp", "transformers"]);
    expect(out.items[0].itemSummary).toContain("self-attention");
    expect(out.items[1].itemSummary).toContain("Bidirectional");
  });

  it("also accepts a `summary` key per item (not only `insight`)", () => {
    const text = JSON.stringify({
      summary: "s",
      topics: [],
      items: [{ url: "https://arxiv.org/abs/1706.03762", summary: "legacy key still works" }],
    });
    const out = parseFolderSummary(text, items);
    expect(out.items[0].itemSummary).toBe("legacy key still works");
  });

  it("falls back to the item title when no insight is given", () => {
    const text = JSON.stringify({ summary: "s", topics: [], items: [] });
    const out = parseFolderSummary(text, items);
    expect(out.items[0].itemSummary).toBe("Attention is all you need");
    expect(out.items).toHaveLength(2);
  });

  it("dedups + lowercases topics and caps them", () => {
    const topics = ["AI", "ai", "ML", "ml", "a", "b", "c", "d", "e", "f", "g", "h"];
    const text = JSON.stringify({ summary: "s", topics, items: [] });
    const out = parseFolderSummary(text, items);
    expect(out.topics).toContain("ai");
    expect(new Set(out.topics).size).toBe(out.topics.length);
    expect(out.topics.length).toBeLessThanOrEqual(8);
  });

  it("throws on a response with no usable JSON summary", () => {
    expect(() => parseFolderSummary("sorry, I cannot do that", items)).toThrow(/parse|summary/i);
  });
});
