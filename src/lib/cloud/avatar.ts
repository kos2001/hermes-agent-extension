/**
 * Deterministic identicon for a member: a stable background color derived from
 * `seed` (use a stable id) and an initial from `label` (the display name).
 * No storage/upload — purely computed.
 */
export function avatarFor(seed: string, label?: string): { bg: string; initial: string } {
  const s = (seed || "?").trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const text = (label ?? s).trim();
  const initial = (text[0] ?? "?").toUpperCase();
  return { bg: `hsl(${hue} 55% 45%)`, initial };
}
