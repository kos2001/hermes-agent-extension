/** Compact relative timestamp for feed/discussion rows ("3m ago", "2d ago"). */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.floor((now.getTime() - t) / 1000);
  if (sec < 60) return "just now"; // includes small clock skew (negative sec)
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  const d = new Date(t);
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

/** True when `iso` falls within the last `windowMs` — used to flash new realtime rows. */
export function isRecent(iso: string, windowMs: number, now: Date = new Date()): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= windowMs;
}
