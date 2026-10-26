const SESSION_COOKIE_NAME = "auth_session";

// Sessions expire after 12 hours (one working day).
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

const encoder = new TextEncoder();

export function getExpectedPassword(): string {
  if (!process.env.AUTH_PASSWORD) {
    throw new Error("AUTH_PASSWORD environment variable is missing.");
  }
  return process.env.AUTH_PASSWORD;
}

/**
 * The signing key combines SESSION_SECRET with AUTH_PASSWORD, so changing
 * either one invalidates every existing session.
 */
async function getSigningKey(): Promise<CryptoKey> {
  const secret = `${process.env.SESSION_SECRET ?? ""}::${getExpectedPassword()}`;
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
  const key = await getSigningKey();
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/**
 * Constant-time comparison of two strings (compares HMAC digests so the
 * inputs' lengths don't leak through timing).
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const [da, dbb] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(a)),
    crypto.subtle.sign("HMAC", key, encoder.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(dbb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Creates a signed session token: v1.<expiresAtMs>.<nonce>.<signature>
 */
export async function createSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${expiresAt}.${nonce}`;
  return `${payload}.${await sign(payload)}`;
}

export async function isValidSessionToken(
  token: string | null | undefined
): Promise<boolean> {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return false;

    const expiresAt = Number(parts[1]);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

    const payload = parts.slice(0, 3).join(".");
    return await safeEqual(parts[3], await sign(payload));
  } catch {
    return false;
  }
}

export { SESSION_COOKIE_NAME };
