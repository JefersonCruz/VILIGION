/**
 * Orquestra o cadastro de ponta a ponta: prova de propriedade do endereço →
 * vínculo telefone↔endereço criptografado → credenciais de login do painel
 * → limiares padrão. Fecha a lacuna "PhoneMappingService.register existe
 * mas não está exposto" (ver ARCHITECTURE.md) E a decisão de design que
 * faltava: o id do login do painel é O MESMO UUID de phone_mappings.id -
 * ver nota em docs/UI-SPEC.md.
 *
 * Tudo isto roda como uma sequência (não uma transação SQL de verdade, já
 * que PhoneMappingService.register já faz sua própria verificação antes de
 * qualquer escrita) - se uma etapa posterior falhar, a anterior já
 * persistiu; aceitável no estágio atual, mas documentado aqui como
 * simplificação, não como design final de produção.
 */

import { createHash } from "node:crypto";
import type { Address } from "viem";
import { PhoneMappingService, type RegisterMappingInput } from "./phone-mapping.js";
import { hashPassword } from "../dashboard/password.js";
import { buildOtpAuthUri, generateBase32Secret } from "../dashboard/totp.js";
import {
  PostgresDashboardUserRepository,
  PostgresPhoneMappingRepository,
  PostgresThresholdsRepository,
} from "../db/postgres-repositories.js";
import type { UserThresholds } from "../engine/rules/detection-rules.js";

/** Limiares padrão pra quem acabou de se cadastrar - ajustáveis depois em /thresholds (ver UI-SPEC.md). */
const DEFAULT_THRESHOLDS: Omit<UserThresholds, "userId"> = {
  maxBalanceDropPct: 20,
  criticalBalanceDropPct: 50,
  windowMinutes: 10,
  blockedTransferAlertThreshold: 1_000_000n,
  criticalBlockedTransferThreshold: 10_000_000n,
};

export interface SignupInput extends RegisterMappingInput {
  username: string;
  password: string;
}

export interface SignupResult {
  userId: string;
  username: string;
  totpSecret: string;
  otpAuthUri: string;
}

export function hashAddress(address: Address): string {
  return createHash("sha256").update(address.toLowerCase()).digest("hex");
}

export class SignupService {
  constructor(
    private readonly phoneMapping: PhoneMappingService,
    private readonly phoneMappingRepo: PostgresPhoneMappingRepository,
    private readonly dashboardUsers: PostgresDashboardUserRepository,
    private readonly thresholds: PostgresThresholdsRepository,
  ) {}

  /** Lança erro se a assinatura não provar posse do endereço (ver PhoneMappingService.register), ou se o username já existir. */
  async signup(input: SignupInput): Promise<SignupResult> {
    const existing = await this.dashboardUsers.findByUsername(input.username);
    if (existing) {
      throw new Error("Nome de usuário já cadastrado - escolha outro.");
    }

    // Verifica a assinatura e criptografa o vínculo - lança erro ANTES de
    // qualquer escrita se a prova de propriedade falhar.
    const encryptedPayload = await this.phoneMapping.register(input);
    const addressHash = hashAddress(input.address);
    const userId = await this.phoneMappingRepo.save(addressHash, encryptedPayload);

    const totpSecret = generateBase32Secret();
    await this.dashboardUsers.create({
      userId,
      username: input.username,
      passwordHash: hashPassword(input.password),
      totpSecret,
    });

    await this.thresholds.upsert({ userId, ...DEFAULT_THRESHOLDS });

    return {
      userId,
      username: input.username,
      totpSecret,
      otpAuthUri: buildOtpAuthUri({ secret: totpSecret, accountName: input.username, issuer: "VILIGION" }),
    };
  }
}
