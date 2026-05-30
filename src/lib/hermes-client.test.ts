import { describe, expect, it } from "vitest";
import { assertHeadersLatin1, findNonLatin1, HermesError, isHermesEndpoint, joinApi } from "./hermes-client";

describe("isHermesEndpoint", () => {
  it("matches local Hermes servers", () => {
    expect(isHermesEndpoint("http://127.0.0.1:8642/v1")).toBe(true);
    expect(isHermesEndpoint("http://localhost:8642/v1")).toBe(true);
    expect(isHermesEndpoint("https://my-hermes.example.com:8642")).toBe(true);
  });
  it("does not match cloud LLM APIs (so the session header isn't sent there)", () => {
    expect(isHermesEndpoint("https://openrouter.ai/api/v1")).toBe(false);
    expect(isHermesEndpoint("https://api.openai.com/v1")).toBe(false);
    expect(isHermesEndpoint("https://api.deepseek.com/v1")).toBe(false);
  });
});

describe("joinApi", () => {
  it("appends the path to provider base URLs that already carry a version", () => {
    expect(joinApi("https://openrouter.ai/api/v1", "chat/completions")).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(joinApi("https://api.z.ai/api/paas/v4", "models")).toBe(
      "https://api.z.ai/api/paas/v4/models",
    );
    expect(joinApi("https://generativelanguage.googleapis.com/v1beta/openai", "models")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
    );
  });

  it("inserts /v1 for bare hosts without a version segment", () => {
    expect(joinApi("http://127.0.0.1:8642", "chat/completions")).toBe(
      "http://127.0.0.1:8642/v1/chat/completions",
    );
    expect(joinApi("https://openrouter.ai/api", "models")).toBe(
      "https://openrouter.ai/api/v1/models",
    );
  });

  it("tolerates trailing slashes and a pasted endpoint suffix", () => {
    expect(joinApi("https://api.deepseek.com/v1/", "models")).toBe(
      "https://api.deepseek.com/v1/models",
    );
    expect(joinApi("https://api.deepseek.com/v1/chat/completions", "chat/completions")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
  });
});

describe("findNonLatin1", () => {
  it("returns null for pure-ASCII values", () => {
    expect(findNonLatin1("Bearer sk-or-v1-abc123")).toBeNull();
  });

  it("accepts the full Latin-1 range (code points 0–255)", () => {
    expect(findNonLatin1("café ÿ résumé")).toBeNull();
  });

  it("flags the first character above U+00FF", () => {
    // em-dash sits at index 5
    const r = findNonLatin1("Hello—world");
    expect(r).toEqual({ char: "—", index: 5, codePoint: 0x2014 });
  });

  it("flags Korean text", () => {
    const r = findNonLatin1("제목");
    expect(r?.codePoint).toBe("제".codePointAt(0));
    expect(r?.index).toBe(0);
  });

  it("handles astral-plane characters (emoji) via the full code point", () => {
    const r = findNonLatin1("ok 😀");
    expect(r?.codePoint).toBe(0x1f600);
    expect(r?.char).toBe("😀");
  });
});

describe("assertHeadersLatin1", () => {
  it("passes clean headers", () => {
    expect(() =>
      assertHeadersLatin1({ "Content-Type": "application/json", "X-Title": "Hermes" }),
    ).not.toThrow();
  });

  it("throws a HermesError naming the offending header and character", () => {
    let err: unknown;
    try {
      assertHeadersLatin1({ "X-Title": "한글 제목" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HermesError);
    expect((err as Error).message).toContain('header "X-Title"');
    expect((err as Error).message).toContain("U+");
  });

  it("uses the friendly label for Authorization (API key)", () => {
    expect(() =>
      assertHeadersLatin1({ Authorization: "Bearer sk—bad" }, { Authorization: "API key" }),
    ).toThrowError(/API key contains a character/);
  });
});
