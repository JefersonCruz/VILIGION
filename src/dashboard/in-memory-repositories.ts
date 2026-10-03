/**
 * Implementações em memória - suficientes pra demo/desenvolvimento local
 * sem precisar de Postgres configurado. Mantidas atrás das mesmas
 * interfaces/ports que as implementações Postgres (db/postgres-repositories.ts,
 * privacy/signup-service.ts) de propósito, pra trocar de uma pra outra sem
 * mudar nenhum chamador - ver a troca em index.ts baseada em DATABASE_URL.
 */

import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { hashPassword } from "./password.js";
import { buildOtpAuthUri, generateBase32Secret } from "./totp.js";
import type {
  AccountDetails,
  AccountDetailsRepository,
  AlertHistoryPort,
  DashboardUser,
  MonitoredAccountsPort,
  UserRepository,
} from "./server.js";
import type { DashboardUserStore, PhoneMappingStore, ThresholdsStore } from "../privacy/signup-service.js";
import type { EncryptedPayload } from "../privacy/encryption.js";
import type { UserThresholds } from "../engine/rules/detection-rules.js";

export interface DemoUserCredentials {
  userId: string;
  username: string;
  /** Senha em claro - só existe aqui porque é a própria criação da demo; nunca loga isso em produção. */
  password: string;
  totpSecret: string;
  otpAuthUri: string;
}

export class InMemoryUserRepository implements UserRepository, DashboardUserStore {
  private readonly byUsername = new Map<string, DashboardUser>();

  async findByUsername(username: string): Promise<DashboardUser | null> {
    return this.byUsername.get(username) ?? null;
  }

  async create(input: { userId: string; username: string; passwordHash: string; totpSecret: string }): Promise<void> {
    this.byUsername.set(input.username, {
      userId: input.userId,
      passwordHash: input.passwordHash,
      totpSecret: input.totpSecret,
    });
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
  alertId: string;
  userId: string;
  kind: string;
  severity: string;
  deliveredVia: string;
  pinStatus: string | null;
  createdAt: Date;
}

/**
 * Log de alertas compartilhado entre o dispatcher (que escreve, em
 * index.ts) e o painel (que lê) - versão em memória; Postgres equivalente é
 * db/postgres-repositories.ts#PostgresAlertLog.
 */
export class InMemoryAlertLog implements AlertHistoryPort {
  private readonly entries: AlertLogEntry[] = [];

  record(input: { alertId: string; userId: string; kind: string; severity: string; deliveredVia: string }): void {
    this.entries.push({ ...input, pinStatus: null, createdAt: new Date() });
  }

  updatePinStatus(alertId: string, pinStatus: string): void {
    const entry = this.entries.find((e) => e.alertId === alertId);
    if (entry) entry.pinStatus = pinStatus;
  }

  recentForUser(userId: string, limit = 10): AlertLogEntry[] {
    return this.entries
      .filter((e) => e.userId === userId)
      .slice(-limit)
      .reverse();
  }

  async detailedForUser(userId: string, limit = 50): ReturnType<AlertHistoryPort["detailedForUser"]> {
    return this.recentForUser(userId, limit);
  }
}

export class InMemoryAccountDetailsRepository implements AccountDetailsRepository {
  constructor(
    private readonly address: Address,
    private readonly alertLog: InMemoryAlertLog,
    /** lê o saldo atual sob demanda, em vez de guardar um valor que fica desatualizado */
    private readonly getBalanceRaw: () => Promise<bigint>,
  ) {}

  async getDetails(userId: string): Promise<AccountDetails> {
    const balanceRaw = await this.getBalanceRaw();

    return {
      address: this.address,
      balanceRaw: balanceRaw.toString(),
      lastAlerts: this.alertLog
        .recentForUser(userId)
        .map((e) => ({ kind: e.kind, createdAt: e.createdAt.toISOString() })),
    };
  }
}

export class InMemoryMonitoredAccountsRepository implements MonitoredAccountsPort {
  private readonly accounts = new Map<string, { id: string; userId: string; chainKey: string; tokenAddress: string; watchedAddress: string }>();

  async listForUser(userId: string) {
    return [...this.accounts.values()].filter((a) => a.userId === userId);
  }

  async add(input: { userId: string; chainKey: string; tokenAddress: string; watchedAddress: string }): Promise<string> {
    const id = randomUUID();
    this.accounts.set(id, { id, ...input });
    return id;
  }

  async remove(id: string, userId: string): Promise<boolean> {
    const account = this.accounts.get(id);
    if (!account || account.userId !== userId) return false;
    this.accounts.delete(id);
    return true;
  }
}

export class InMemoryThresholdsRepository implements ThresholdsStore {
  private readonly byUser = new Map<string, UserThresholds>();

  async get(userId: string): Promise<UserThresholds | null> {
    return this.byUser.get(userId) ?? null;
  }

  async upsert(thresholds: UserThresholds): Promise<void> {
    this.byUser.set(thresholds.userId, thresholds);
  }
}

export class InMemoryPhoneMappingRepository implements PhoneMappingStore {
  private readonly byHash = new Map<string, { id: string; payload: EncryptedPayload }>();

  async save(addressHash: string, payload: EncryptedPayload): Promise<string> {
    const existing = this.byHash.get(addressHash);
    const id = existing?.id ?? randomUUID();
    this.byHash.set(addressHash, { id, payload });
    return id;
  }
}
