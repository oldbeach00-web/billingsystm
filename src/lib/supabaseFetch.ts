/**
 * fetch for the Supabase clients that retries a database request once when
 * PostgREST rejects a valid, just-issued access token.
 *
 * Right after login, PostgREST has refused one request with 401 / PGRST303
 * ("JWT claims validation or parsing error") while other requests carrying
 * the same token, sent within milliseconds, succeeded; the same request
 * succeeded a second later (production logs, 26 and 27 Oct 2026). The
 * rejection happens before the request runs, so repeating it is safe, even
 * for writes.
 */

const RETRY_DELAY_MS = 500;

async function isRejectedToken(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  if (res.headers.get("proxy-status")?.includes("PGRST303")) return true;
  try {
    const body = (await res.clone().json()) as { code?: string } | null;
    return body?.code === "PGRST303";
  } catch {
    return false;
  }
}

export const supabaseFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (!(await isRejectedToken(res))) return res;

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  // During a server render Next.js hands back the first response for an
  // identical GET instead of sending it again; a request with its own abort
  // signal is sent for real
  return fetch(input, {
    ...init,
    signal: init?.signal ?? new AbortController().signal,
  });
};
