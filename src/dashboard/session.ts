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
  /**
   * Sessão de AVALIAÇÃO (um fator, ver judge-access.ts), que só pode escrever
   * numa lista curta de rotas e não pode abrir `/recipients`.
   *
   * A marca mora NA SESSÃO, e não num conjunto separado, porque separada ela
   * podia ser perdida enquanto a sessão seguia válida - e perder a marca não
   * derrubava o acesso, só a restrição. Era um `Set` de 200 tokens que
   * descartava o mais antigo quando enchia: descarte por VOLUME, escolhido por
   * quem abre as sessões, e o login de jurado ainda reseta o rate limiter
   * quando dá certo. Medido com o servidor HTTP de verdade: depois de 200
   * logins a mais, a primeira sessão passava a responder 200 em
   * `GET /recipients` - a página que lista o telefone do dono - em vez de 403.
   *
   * Aqui a marca nasce e morre junto com a sessão. Não há lifetime separado
   * pra errar, e não há limite de quantidade pra estourar.
   */
  isJudge: boolean;
}

/** Inatividade tolerada. Navegar reinicia esta contagem. */
export const SESSION_IDLE_MINUTES = 30;

/** Teto absoluto desde o login, independente de atividade. */
export const SESSION_ABSOLUTE_HOURS = 12;

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(userId: string, options: { judge?: boolean } = {}): Session {
    const now = new Date();
    /*
     * Varre o que já expirou antes de inserir. O conjunto de jurado tinha um
     * teto de 200 tokens justamente por medo de vazar memória num processo que
     * roda sem parar; esta varredura é o que torna o teto desnecessário - e
     * conserta, de passagem, o mesmo acúmulo que já existia aqui, onde uma
     * sessão só saía do Map quando alguém a tocava de novo.
     */
    this.pruneExpired(now);
    const session: Session = {
      token: randomBytes(32).toString("hex"),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_IDLE_MINUTES * 60_000),
      isJudge: options.judge === true,
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

    if (this.expirou(session, now)) {
      this.sessions.delete(token);
      return null;
    }

    session.expiresAt = new Date(
      Math.min(now.getTime() + SESSION_IDLE_MINUTES * 60_000, this.limiteAbsoluto(session)),
    );
    return session;
  }

  /**
   * Lê a sessão SEM empurrar o prazo.
   *
   * Existe porque a política de avaliação é decidida ANTES do roteamento, em
   * toda requisição (ver server.ts): se essa consulta renovasse a sessão, uma
   * requisição NEGADA pela política passaria a manter a sessão viva, o que é
   * o contrário do que uma recusa deve fazer.
   */
  peek(token: string | undefined, now: Date = new Date()): Session | null {
    if (token === undefined) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (this.expirou(session, now)) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }

  private limiteAbsoluto(session: Session): number {
    return session.createdAt.getTime() + SESSION_ABSOLUTE_HOURS * 3_600_000;
  }

  private expirou(session: Session, now: Date): boolean {
    return now > session.expiresAt || now.getTime() > this.limiteAbsoluto(session);
  }

  private pruneExpired(now: Date): void {
    for (const [token, session] of this.sessions) {
      if (this.expirou(session, now)) this.sessions.delete(token);
    }
  }
}
