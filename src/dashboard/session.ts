/**
 * Sessão de painel - token aleatório opaco guardado server-side (não JWT
 * auto-contido), pra permitir revogação imediata se necessário. Expira
 * sozinho, não precisa de logout explícito pra ser seguro.
 */

import { randomBytes } from "node:crypto";

export interface Session {
  token: string;
  userId: string;
  expiresAt: Date;
}

const SESSION_TTL_MINUTES = 30;

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(userId: string): Session {
    const session: Session = {
      token: randomBytes(32).toString("hex"),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MINUTES * 60_000),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  validate(token: string, now: Date = new Date()): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (now > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }
}
