const SESSION_COOKIE_NAME = "auth_session";

export function getExpectedPassword(): string {
  if (!process.env.AUTH_PASSWORD) {
    throw new Error("AUTH_PASSWORD environment variable is missing.");
  }
  return process.env.AUTH_PASSWORD;
}

export function createSessionToken(password: string): string {
  const secret = getExpectedPassword();
  const raw = `${password}::${secret}::billing_secure_session_2026`;
  
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `sess_${Math.abs(hash).toString(36)}`;
}

export function isValidSessionToken(token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    const validToken = createSessionToken(getExpectedPassword());
    return token === validToken;
  } catch {
    return false;
  }
}

export { SESSION_COOKIE_NAME };
