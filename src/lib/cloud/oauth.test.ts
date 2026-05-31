import { describe, expect, it } from "vitest";
import { parseTokensFromRedirect } from "./oauth";

describe("parseTokensFromRedirect", () => {
  it("extracts access and refresh tokens from the URL fragment", () => {
    const url = "https://abc.chromiumapp.org/#access_token=AAA&refresh_token=BBB&token_type=bearer";
    expect(parseTokensFromRedirect(url)).toEqual({ accessToken: "AAA", refreshToken: "BBB" });
  });

  it("also reads tokens from the query string (fallback)", () => {
    const url = "https://abc.chromiumapp.org/?access_token=AAA&refresh_token=BBB";
    expect(parseTokensFromRedirect(url)).toEqual({ accessToken: "AAA", refreshToken: "BBB" });
  });

  it("surfaces a provider error", () => {
    const url = "https://abc.chromiumapp.org/#error=access_denied&error_description=nope";
    expect(() => parseTokensFromRedirect(url)).toThrow(/access_denied/);
  });

  it("throws when tokens are absent", () => {
    expect(() => parseTokensFromRedirect("https://abc.chromiumapp.org/")).toThrow(/no tokens/i);
  });
});
