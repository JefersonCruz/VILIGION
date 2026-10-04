/**
 * Junta as duas peças da camada de identidade do cadastro: só cria a linha
 * de posse de endereço depois de verificar a prova de propriedade
 * (ownership-proof.ts), e sempre guarda o registro criptografado
 * (encryption.ts) - nunca em texto puro.
 *
 * Não coleta mais telefone aqui (achado da auditoria de 2026-10-03): este
 * registro só serve pra ancorar a identidade (phone_mappings.id = user_id
 * usado em todo o resto do schema, ver signup-service.ts), não pra entregar
 * alerta - isso é /recipients (ver dashboard/in-memory-repositories.ts ou
 * db/postgres-repositories.ts#PostgresRecipientsRepository), que criptografa
 * o destino de verdade e é o que o dispatcher em index.ts realmente lê. Um
 * telefone "virtual" coletado aqui e nunca decriptado em lugar nenhum era
 * decorativo - contradizia a própria ameaça #1 do SECURITY.md sem proteger
 * nada na prática.
 */

import type { Address } from "viem";
import { verifyOwnership } from "./ownership-proof.js";
import type { MappingEncryption } from "./encryption.js";

export interface RegisterMappingInput {
  address: Address;
  nonce: string;
  signature: `0x${string}`;
}

export class PhoneMappingService {
  constructor(private readonly encryption: MappingEncryption) {}

  /**
   * Registra a posse do endereço só se a assinatura provar controle dele.
   * Lança erro explícito em vez de silenciosamente ignorar - cadastro falho
   * não deve parecer sucesso.
   */
  async register(input: RegisterMappingInput) {
    const isOwner = await verifyOwnership({
      address: input.address,
      nonce: input.nonce,
      signature: input.signature,
    });

    if (!isOwner) {
      throw new Error(
        "Assinatura não corresponde ao endereço informado - cadastro recusado. " +
          "Isto impede que alguém registre o endereço público de terceiros como se fosse seu.",
      );
    }

    const payload = JSON.stringify({
      address: input.address,
      registeredAt: new Date().toISOString(),
    });

    return this.encryption.encrypt(payload);
  }
}
