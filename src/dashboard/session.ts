/**
 * Sessão de painel - token aleatório opaco guardado server-side (não JWT
 * auto-contido), pra permitir revogação imediata se necessário. Expira
 * sozinho, não precisa de logout explícito pra ser seguro.
 *
 * A validade é DESLIZANTE: cada requisição autenticada empurra o prazo pra
 * frente. Antes era prazo fixo desde o login, o que derrubava alguém no meio
 * de uma tarefa mesmo navegando ativamente - 30 minutos depois do login, ponto.
 * Prazo fixo mede a idade do login; o que se quer medir é INATIVIDADE.
 *
 * Mesmo deslizando, existe um teto absoluto: uma aba esquecida aberta não
 * mantém acesso indefinidamente, e um token roubado tem vida máxima conhecida.
 */

import { randomBytes } from "node:crypto";

export interface Session {
  token: string;
  userId: string;
  /** Quando o login aconteceu. Base do teto absoluto - nunca é empurrado. */
  createdAt: Date;
  /** Prazo deslizante: recalculado a cada validação bem-sucedida. */
  expiresAt: Date;
}

/** Inatividade tolerada. Navegar reinicia esta contagem. */
export const SESSION_IDLE_MINUTES = 30;

/** Teto absoluto desde o login, independente de atividade. */
export const SESSION_ABSOLUTE_HOURS = 12;

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(userId: string): Session {
    const now = new Date();
    const session: Session = {
      token: randomBytes(32).toString("hex"),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_MINUTES * 60_000),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  /**
   * Valida e, de quebra, renova. Devolver a sessão e empurrar o prazo são a
   * mesma operação de propósito: assim nenhuma rota protegida pode esquecer
   * de renovar, e a renovação acontece exatamente nos acessos que provam
   * que a pessoa está ali.
   */
  validate(token: string, now: Date = new Date()): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    const limiteAbsoluto = session.createdAt.getTime() + SESSION_ABSOLUTE_HOURS * 3_600_000;
    if (now > session.expiresAt || now.getTime() > limiteAbsoluto) {
      this.sessions.delete(token);
      return null;
    }

    session.expiresAt = new Date(
      Math.min(now.getTime() + SESSION_IDLE_MINUTES * 60_000, limiteAbsoluto),
    );
    return session;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }
}
