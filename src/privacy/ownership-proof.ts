/**
 * Exige prova de que quem está cadastrando um telefone realmente controla o
 * endereço — sem isto, qualquer pessoa cadastra o endereço público de
 * terceiros com o próprio telefone e passa a receber alertas de saldo
 * alheio (achado crítico da revisão de segurança, ver SECURITY.md).
 */

import { type Address, verifyMessage } from "viem";

/** Mensagem que o usuário assina com a própria carteira pra provar posse do endereço. */
export function buildOwnershipChallenge(address: Address, nonce: string): string {
  return [
    "VILIGION - Prova de propriedade de endereço",
    `Endereço: ${address}`,
    `Nonce: ${nonce}`,
    "Esta assinatura não autoriza nenhuma transação, apenas comprova controle da chave.",
  ].join("\n");
}

export async function verifyOwnership(params: {
  address: Address;
  nonce: string;
  signature: `0x${string}`;
}): Promise<boolean> {
  const message = buildOwnershipChallenge(params.address, params.nonce);

  return verifyMessage({
    address: params.address,
    message,
    signature: params.signature,
  });
}
