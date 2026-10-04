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

/**
 * Nível de urgência do alerta — decide o CANAL de entrega (ver dispatch em
 * index.ts), não só o conteúdo. "critical" vai por ligação telefônica
 * (Twilio, tem custo e fica registrado na operadora - ver SECURITY.md);
 * "normal" vai por e-mail (sem custo por mensagem, sem o mesmo problema de
 * retenção de CDR). Decisão de produto: nem toda anomalia justifica o
 * custo/exposição de uma ligação - só a que de fato é urgente.
 */
export type AlertSeverity = "normal" | "critical";

/** Configuração privada por usuário — NUNCA hardcoded, NUNCA neste arquivo. */
export interface UserThresholds {
  userId: string;
  /** percentual de queda de saldo, numa janela de tempo, que dispara alerta (severidade normal) */
  maxBalanceDropPct: number;
  /** percentual de queda a partir do qual o alerta escala pra ligação telefônica */
  criticalBalanceDropPct: number;
  /** janela de tempo (minutos) usada pro cálculo de queda percentual */
  windowMinutes: number;
  /** valor absoluto bloqueado pelo ReceivePolicyGuard que já dispara alerta (severidade normal) */
  blockedTransferAlertThreshold: bigint;
  /** valor a partir do qual a transferência bloqueada escala pra ligação telefônica */
  criticalBlockedTransferThreshold: bigint;
}

export type DetectionEvent =
  | {
      kind: "balance-drop";
      userId: string;
      pctDropped: number;
      windowMinutes: number;
      severity: AlertSeverity;
    }
  | {
      kind: "transfer-blocked";
      userId: string;
      amount: bigint;
      blockedNonce: bigint;
      severity: AlertSeverity;
    };

/**
 * Compara dois snapshots de saldo e decide se a queda ultrapassa o limiar
 * configurado do usuário. Não decide sozinho se é "fee" ou "valor real" —
 * isso é responsabilidade do adaptador de chain (ver EvmAdapter.getFeeAdjustment,
 * sobrescrito em TempoAdapter), já aplicado pelo chamador (monitor.ts#tick)
 * ANTES desta função, somando de volta qualquer dedução de taxa ao saldo atual.
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
    severity: pctDropped >= thresholds.criticalBalanceDropPct ? "critical" : "normal",
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
    severity: event.amount >= thresholds.criticalBlockedTransferThreshold ? "critical" : "normal",
  };
}
