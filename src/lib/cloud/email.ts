/** Lightweight email check for the sign-in form (not RFC-exhaustive). */
export function isValidEmail(raw: string): boolean {
  const email = raw.trim();
  // local@domain.tld — no whitespace, a dot in the domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
