/**
 * node:http não parseia cookie nem monta Set-Cookie - helper mínimo, só o
 * necessário pro cookie de sessão do painel (HttpOnly, nunca lido por JS no
 * cliente, mitiga roubo de token via XSS).
 */

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  return `viligion_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildExpiredSessionCookie(): string {
  return `viligion_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
