/**
 * Lógica de detecção — PÚBLICA por design (ver ARCHITECTURE.md). O que fica
 * de fora, em configuração privada por usuário, são os limiares numéricos
 * exatos (ver UserThresholds). Publicar o mecanismo e esconder só o número
 * evita dar a um atacante um manual exato de como ficar sempre abaixo do
 * limite — mas não é segredo absoluto: ver nota em SECURITY.md sobre
 * "obscurecido, não secreto".
 */

import type { BalanceSnapshot } from "../chains/evm-adapter.js";
import type { TransferBlockedEvent } from "../chains/tempo.adapter.js";

/** Configuração privada por usuário — NUNCA hardcoded, NUNCA neste arquivo. */
export interface UserThresholds {
  userId: string;
  /** percentual de queda de saldo, numa janela de tempo, que dispara alerta */
  maxBalanceDropPct: number;
  /** janela de tempo (minutos) usada pro cálculo de queda percentual */
  windowMinutes: number;
  /** valor absoluto bloqueado pelo ReceivePolicyGuard que já dispara sozinho, independente de percentual */
  blockedTransferAlertThreshold: bigint;
}

export type DetectionEvent =
  | {
      kind: "balance-drop";
      userId: string;
      pctDropped: number;
      windowMinutes: number;
    }
  | {
      kind: "transfer-blocked";
      userId: string;
      amount: bigint;
      blockedNonce: bigint;
    };

/**
 * Compara dois snapshots de saldo e decide se a queda ultrapassa o limiar
 * configurado do usuário. Não decide sozinho se é "fee" ou "valor real" —
 * isso é responsabilidade do adaptador de chain (ver TempoAdapter.classifyBalanceDelta),
 * que deve ser chamado ANTES desta função, filtrando deltas de fee.
 */
export function checkBalanceDrop(
  previous: BalanceSnapshot,
  current: BalanceSnapshot,
  thresholds: UserThresholds,
): DetectionEvent | null {
  if (previous.raw === 0n) return null;

  const elapsedMinutes =
    (current.observedAt.getTime() - previous.observedAt.getTime()) / 60_000;
  if (elapsedMinutes > thresholds.windowMinutes) return null;

  const delta = previous.raw - current.raw;
  if (delta <= 0n) return null;

  const pctDropped = Number((delta * 10_000n) / previous.raw) / 100;
  if (pctDropped < thresholds.maxBalanceDropPct) return null;

  return {
    kind: "balance-drop",
    userId: thresholds.userId,
    pctDropped,
    windowMinutes: elapsedMinutes,
  };
}

/** Transferência bloqueada pelo ReceivePolicyGuard (evento TransferBlocked) acima do limiar do usuário. */
export function checkBlockedTransfer(
  event: TransferBlockedEvent,
  thresholds: UserThresholds,
): DetectionEvent | null {
  if (event.amount < thresholds.blockedTransferAlertThreshold) return null;

  return {
    kind: "transfer-blocked",
    userId: thresholds.userId,
    amount: event.amount,
    blockedNonce: event.blockedNonce,
  };
}
