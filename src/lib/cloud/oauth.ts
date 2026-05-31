export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Parse the redirect URL captured by chrome.identity.launchWebAuthFlow.
 * Supabase's implicit flow returns tokens in the URL fragment; we also accept
 * the query string as a fallback. Throws on a provider error or missing tokens.
 */
export function parseTokensFromRedirect(redirectUrl: string): OAuthTokens {
  const u = new URL(redirectUrl);
  const frag = new URLSearchParams(u.hash.replace(/^#/, ""));
  const pick = (k: string) => frag.get(k) ?? u.searchParams.get(k);

  const error = pick("error");
  if (error) throw new Error(`${error}: ${pick("error_description") ?? ""}`.trim());

  const accessToken = pick("access_token");
  const refreshToken = pick("refresh_token");
  if (!accessToken || !refreshToken) throw new Error("OAuth redirect carried no tokens");
  return { accessToken, refreshToken };
}
