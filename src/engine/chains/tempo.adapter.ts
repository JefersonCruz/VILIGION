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
 * Decodificação do recibo (bytes opacos do campo `receipt`, o witness
 * `ClaimReceiptV1` da TIP-1028) via `ox/tempo` (ReceivePolicyReceipt) — pacote
 * oficial do ecossistema viem/ox com suporte dedicado à Tempo, já instalado
 * como dependência transitiva do viem. Não reinventamos esse decode: antes
 * este arquivo tratava `receipt` como bytes opacos (TODO não implementado);
 * `ox` decodifica o witness inteiro (motivo do bloqueio, tipo de operação,
 * memo, autoridade de recuperação) com uma chamada.
 *
 * Fontes oficiais consultadas e confirmadas em 2026-10-01:
 * - https://tempo.xyz/developers/docs/protocol/tip403/receive-policies (ABI do evento, citado literalmente abaixo)
 * - https://tempo.xyz/developers/docs/guide/payments/configure-receive-policies (endereço do contrato, comportamento)
 * - https://tempo.xyz/developers/docs/protocol/tip403/spec (interface ITIP403Registry - política em si, não o guard)
 * - https://tempo.xyz/developers/docs/protocol/tip20/overview
 * - https://tempo.xyz/developers/docs/quickstart/connection-details (RPC/chain ID reais)
 * - https://docs.tempo.xyz/protocol/tips/tip-1028 (layout do ClaimReceiptV1, decodificado via ox/tempo)
 *
 * Fonte adicional, confirmada em 2026-10-03 (fecha o TODO que existia em
 * `getFeeAdjustment` - ver ARCHITECTURE.md → "Architecture gaps"):
 * - https://tempo.xyz/developers/docs/protocol/fees/spec-fee ("Log a Transfer
 *   event from the user to the fee manager contract for the net amount of
 *   the fee payment" - a taxa não é um evento próprio, é um Transfer comum
 *   do token TIP-20 pro FeeManager, com possível Transfer de volta em caso
 *   de reembolso pós-execução)
 * - https://tempo.xyz/developers/docs/protocol/fees/spec-fee-amm (endereço
 *   fixo do precompile FeeManager, citado literalmente abaixo)
 */

import { type Address, type Log, decodeEventLog, parseAbi } from "viem";
import { ReceivePolicyReceipt } from "ox/tempo";
import { EvmAdapter, type EvmAdapterConfig } from "./evm-adapter.js";

/**
 * Endereço oficial do ReceivePolicyGuard na Tempo (igual em mainnet e
 * testnet Moderato, por ser um "endereço de sistema" previsível - confirme
 * isso se a doc mudar).
 */
export const RECEIVE_POLICY_GUARD_ADDRESS: Address =
  "0xB10C000000000000000000000000000000000000";

/**
 * Precompile FeeManager da Tempo - endereço fixo de sistema (igual a
 * RECEIVE_POLICY_GUARD_ADDRESS acima), confirmado em
 * https://tempo.xyz/developers/docs/protocol/fees/spec-fee-amm em 2026-10-03.
 * Todo pagamento de taxa é um Transfer TIP-20 comum pra este endereço -
 * usado em getFeeAdjustment pra diferenciar taxa de saída real de valor.
 */
export const FEE_MANAGER_ADDRESS: Address =
  "0xfeeC000000000000000000000000000000000000";

/** Evento Transfer padrão TIP-20/ERC-20 - usado pra achar pagamentos de taxa, não pro saldo em si (isso é balanceOf). */
const ERC20_TRANSFER_ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

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
  /** Witness ClaimReceiptV1 decodificado (TIP-1028) via ox/tempo — motivo do bloqueio, tipo de operação, memo. */
  receiptDecoded: ReceivePolicyReceipt.Decoded;
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
   * TransferBlocked) entre dois blocos. `toBlock` vem do chamador (ver
   * ChainExtension#checkExtra) - não recalcula o bloco confirmado aqui, pra
   * não duplicar a mesma chamada RPC que o Monitor já fez um instante antes
   * (achado de performance de 2026-10-03).
   *
   * Nota: um bloqueio também emite um Transfer/Mint TIP-20 normal com o
   * ReceivePolicyGuard como destinatário, além do TransferBlocked. Este
   * método olha só o TransferBlocked, que é o sinal inequívoco de bloqueio -
   * não dá pra inferir isso só de um Transfer comum.
   */
  async getBlockedTransfers(fromBlock: bigint, toBlock: bigint): Promise<TransferBlockedEvent[]> {
    const logs = await this.getConfirmedLogs({
      address: this.guardAddress,
      fromBlock,
      toBlock,
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
        receiptDecoded: ReceivePolicyReceipt.decode(args.receipt),
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
   * Quanto do delta de saldo entre dois blocos é só pagamento de taxa (não
   * saída real de valor) - sobrescreve o default (0n) de EvmAdapter porque a
   * Tempo não tem gas token nativo: a taxa sai do próprio TIP-20 monitorado
   * (ver cabeçalho do arquivo). Sem isto, uma sequência de transações
   * legítimas que só paga taxa dispara falso positivo de "queda de saldo"
   * (achado da auditoria de 2026-10-03 - ver ARCHITECTURE.md).
   *
   * Implementação: todo pagamento de taxa aparece como um Transfer TIP-20
   * comum do endereço observado pro FeeManager (0xfeeC...), com um Transfer
   * de volta em caso de reembolso pós-execução - não é um evento próprio,
   * então não dá pra usar getBlockedTransfers/decodeEventLog do Guard aqui;
   * é o ABI padrão de Transfer, aplicado ao endereço do TOKEN, não do Guard.
   */
  async getFeeAdjustment(fromBlock: bigint, toBlock: bigint, address: Address): Promise<bigint> {
    const tokenAddress = this.config.tokenAddress;
    if (!tokenAddress || fromBlock >= toBlock) return 0n;

    const logs = await this.getConfirmedLogs({ address: tokenAddress, fromBlock: fromBlock + 1n, toBlock });

    let feesPaid = 0n;
    let refunded = 0n;

    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi: ERC20_TRANSFER_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "Transfer") continue;

        const { from, to, value } = decoded.args as unknown as { from: Address; to: Address; value: bigint };
        if (sameAddress(from, address) && sameAddress(to, FEE_MANAGER_ADDRESS)) {
          feesPaid += value;
        } else if (sameAddress(from, FEE_MANAGER_ADDRESS) && sameAddress(to, address)) {
          refunded += value;
        }
      } catch {
        // Log não é Transfer (ex: Approval do mesmo token) - ignora, igual ao decode do Guard acima.
      }
    }

    const net = feesPaid - refunded;
    return net > 0n ? net : 0n;
  }
}

function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
