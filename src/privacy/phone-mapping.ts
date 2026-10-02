/**
 * Junta as duas peças da camada de privacidade: só cria o vínculo
 * telefone↔endereço depois de verificar a prova de propriedade
 * (ownership-proof.ts), e sempre guarda o vínculo criptografado
 * (encryption.ts) - nunca em texto puro, nunca no payload de um alerta.
 */

import type { Address } from "viem";
import { verifyOwnership } from "./ownership-proof.js";
import type { MappingEncryption } from "./encryption.js";

export interface RegisterMappingInput {
  address: Address;
  /** número de telefone VIRTUAL dedicado (nunca o pessoal do dono - ver README.md) */
  virtualPhoneNumber: string;
  nonce: string;
  signature: `0x${string}`;
}

export class PhoneMappingService {
  constructor(private readonly encryption: MappingEncryption) {}

  /**
   * Registra o vínculo só se a assinatura provar posse do endereço.
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
          "Isto impede que alguém registre o endereço público de terceiros com o próprio telefone.",
      );
    }

    const payload = JSON.stringify({
      address: input.address,
      phone: input.virtualPhoneNumber,
      registeredAt: new Date().toISOString(),
    });

    return this.encryption.encrypt(payload);
  }
}
