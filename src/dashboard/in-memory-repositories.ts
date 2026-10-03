/**
 * Implementações em memória de UserRepository e AccountDetailsRepository,
 * suficientes pra demo/desenvolvimento local. Em produção, trocar pela
 * leitura real via Postgres (ver privacy/mapping-schema.sql) - mantidas
 * atrás das mesmas interfaces de dashboard/server.ts de propósito, pra essa
 * troca não exigir mudar o servidor.
 */

import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { hashPassword } from "./password.js";
import { buildOtpAuthUri, generateBase32Secret } from "./totp.js";
import type { AccountDetails, AccountDetailsRepository, DashboardUser, UserRepository } from "./server.js";

export interface DemoUserCredentials {
  userId: string;
  username: string;
  /** Senha em claro - só existe aqui porque é a própria criação da demo; nunca loga isso em produção. */
  password: string;
  totpSecret: string;
  otpAuthUri: string;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byUsername = new Map<string, DashboardUser>();

  async findByUsername(username: string): Promise<DashboardUser | null> {
    return this.byUsername.get(username) ?? null;
  }

  /** Cria um usuário de demo com senha aleatória e segredo TOTP novo - devolve tudo pra exibir uma única vez. */
  createDemoUser(username: string): DemoUserCredentials {
    const userId = randomUUID();
    const password = randomUUID().slice(0, 12);
    const totpSecret = generateBase32Secret();

    this.byUsername.set(username, {
      userId,
      passwordHash: hashPassword(password),
      totpSecret,
    });

    return {
      userId,
      username,
      password,
      totpSecret,
      otpAuthUri: buildOtpAuthUri({ secret: totpSecret, accountName: username, issuer: "VILIGION" }),
    };
  }
}

export interface AlertLogEntry {
  kind: string;
  createdAt: Date;
}

/**
 * Log de alertas compartilhado entre o dispatcher (que escreve, em
 * index.ts) e o painel (que lê) - propositalmente simples, sem persistência
 * real ainda (ver TODO em mapping-schema.sql / tabela alert_log).
 */
export class InMemoryAlertLog {
  private readonly entries: AlertLogEntry[] = [];

  record(kind: string): void {
    this.entries.push({ kind, createdAt: new Date() });
  }

  recent(limit = 10): AlertLogEntry[] {
    return this.entries.slice(-limit).reverse();
  }
}

export class InMemoryAccountDetailsRepository implements AccountDetailsRepository {
  constructor(
    private readonly address: Address,
    private readonly alertLog: InMemoryAlertLog,
    /** lê o saldo atual sob demanda, em vez de guardar um valor que fica desatualizado */
    private readonly getBalanceRaw: () => Promise<bigint>,
  ) {}

  async getDetails(_userId: string): Promise<AccountDetails> {
    const balanceRaw = await this.getBalanceRaw();

    return {
      address: this.address,
      balanceRaw: balanceRaw.toString(),
      lastAlerts: this.alertLog.recent().map((e) => ({ kind: e.kind, createdAt: e.createdAt.toISOString() })),
    };
  }
}
