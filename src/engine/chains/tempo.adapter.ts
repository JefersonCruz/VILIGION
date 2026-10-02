/**
 * Adaptador específico da blockchain Tempo.
 *
 * Duas particularidades da Tempo que NÃO existem em EVM genérico e por isso
 * não podem viver em evm-adapter.ts (ver achados do agente de segurança):
 *
 * 1. Tempo não tem token de gas nativo — toda fee é paga no próprio token
 *    TIP-20. Isso significa que "saldo caiu X%" pode ser só pagamento de taxa
 *    em lote de transações legítimas, não um ataque. Precisamos diferenciar
 *    dedução de fee de saída real de valor.
 *
 * 2. Quando uma transferência é bloqueada por uma "receive policy" (TIP-403),
 *    a chamada NÃO reverte — ela tem sucesso, mas os fundos são creditados ao
 *    contrato ReceivePolicyGuard em vez do destinatário, gerando um recibo
 *    resgatável depois. A regra de detecção não pode simplesmente observar
 *    transações revertidas: precisa decodificar o evento específico do
 *    contrato Guard.
 *
 * Fontes oficiais consultadas e confirmadas em 2026-10-01:
 * - https://tempo.xyz/developers/docs/protocol/tip403/receive-policies (ABI do evento, citado literalmente abaixo)
 * - https://tempo.xyz/developers/docs/guide/payments/configure-receive-policies (endereço do contrato, comportamento)
 * - https://tempo.xyz/developers/docs/protocol/tip403/spec (interface ITIP403Registry - política em si, não o guard)
 * - https://tempo.xyz/developers/docs/protocol/tip20/overview
 * - https://tempo.xyz/developers/docs/quickstart/connection-details (RPC/chain ID reais)
 *
 * ⚠️ Confirmado via leitura da documentação oficial, mas NÃO verificado
 * contra o bytecode/source do contrato deployado. Antes de produção, valide
 * contra a implementação real (ou aguarde a spec completa em https://tips.sh/1028,
 * que a própria doc da Tempo cita como fonte de assinaturas de função —
 * claim(...) e burnBlockedReceipt(...) ainda não têm assinatura exata confirmada).
 */

import { type Address, type Log, decodeEventLog, parseAbi } from "viem";
import { EvmAdapter, type EvmAdapterConfig } from "./evm-adapter.js";

/**
 * Endereço oficial do ReceivePolicyGuard na Tempo (igual em mainnet e
 * testnet Moderato, por ser um "endereço de sistema" previsível - confirme
 * isso se a doc mudar).
 */
export const RECEIVE_POLICY_GUARD_ADDRESS: Address =
  "0xB10C000000000000000000000000000000000000";

/**
 * ABI confirmado via documentação oficial (citação literal, ver fontes
 * acima). "A blocked transfer emits the regular Transfer event with
 * ReceivePolicyGuard as the recipient, then TransferBlocked(...)".
 */
const RECEIVE_POLICY_GUARD_ABI = parseAbi([
  "event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)",
]);

export interface TransferBlockedEvent {
  token: Address;
  receiver: Address;
  blockedNonce: bigint;
  amount: bigint;
  receiptVersion: number;
  receipt: `0x${string}`;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}

export interface TempoAdapterConfig extends EvmAdapterConfig {
  receivePolicyGuardAddress: Address;
}

export class TempoAdapter extends EvmAdapter {
  private readonly guardAddress: Address;

  constructor(config: TempoAdapterConfig) {
    super(config);
    this.guardAddress = config.receivePolicyGuardAddress;
  }

  /**
   * Busca transferências bloqueadas pelo ReceivePolicyGuard (evento
   * TransferBlocked) desde um bloco, já respeitando a profundidade de
   * confirmação herdada do adaptador genérico (proteção contra reorg).
   *
   * Nota: um bloqueio também emite um Transfer/Mint TIP-20 normal com o
   * ReceivePolicyGuard como destinatário, além do TransferBlocked. Este
   * método olha só o TransferBlocked, que é o sinal inequívoco de bloqueio -
   * não dá pra inferir isso só de um Transfer comum.
   */
  async getBlockedTransfers(fromBlock: bigint): Promise<TransferBlockedEvent[]> {
    const logs = await this.getConfirmedLogs({
      address: this.guardAddress,
      fromBlock,
    });

    const events: TransferBlockedEvent[] = [];

    for (const log of logs) {
      const decoded = this.tryDecodeGuardEvent(log);
      if (decoded) events.push(decoded);
    }

    return events;
  }

  private tryDecodeGuardEvent(log: Log): TransferBlockedEvent | null {
    try {
      const decoded = decodeEventLog({
        abi: RECEIVE_POLICY_GUARD_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "TransferBlocked") return null;

      const args = decoded.args as unknown as {
        token: Address;
        receiver: Address;
        blockedNonce: bigint;
        amount: bigint;
        receiptVersion: number;
        receipt: `0x${string}`;
      };

      return {
        ...args,
        blockNumber: log.blockNumber ?? 0n,
        transactionHash: log.transactionHash ?? "0x",
      };
    } catch {
      // Log não é do evento esperado - ignora silenciosamente, é normal
      // quando o contrato emite outros eventos além deste (ex: o Transfer
      // TIP-20 normal que acompanha todo bloqueio).
      return null;
    }
  }

  /**
   * Diferencia uma queda de saldo causada por pagamento de fee (normal, em
   * TIP-20) de uma saída real de valor (potencial anomalia). Sem isto, toda
   * sequência de transações legítimas vira falso positivo.
   *
   * TODO: implementar a lógica real de classificação consultando o campo de
   * fee da transação Tempo (ver "Tempo transactions" na doc oficial) antes de
   * usar em produção — isto é um stub que sempre classifica como "valor real"
   * até ser implementado.
   */
  classifyBalanceDelta(_txHash: `0x${string}`): "fee" | "value-transfer" {
    return "value-transfer";
  }
}
