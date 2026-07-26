/**
 * Was the request unable to reach the server at all?
 *
 * PocketBase's SDK builds a `ClientResponseError` for every failure, but when
 * `fetch` itself rejects — server down, stale tunnel hostname, DNS miss, CORS
 * block, or an https page calling an http origin — there is no response body to
 * read a message from, so it falls back to `status: 0` and the literal string
 * "Something went wrong.". That text names neither the cause nor the host, so
 * callers should detect this case and say which URL was unreachable instead.
 */
export function isUnreachable(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: unknown }).status === 0 &&
    !(e as { isAbort?: unknown }).isAbort
  );
}
