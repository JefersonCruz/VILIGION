import type { UserThresholds } from "./detection-rules.js";

export const MIN_WINDOW_MINUTES = 1;
export const MAX_WINDOW_MINUTES = 1440;
export const MIN_DROP_PCT = 0.1;

/** Devolve a mensagem do primeiro problema encontrado, ou null se os limiares são coerentes. */
export function validateThresholds(t: UserThresholds): string | null {
  const numbers = [t.maxBalanceDropPct, t.criticalBalanceDropPct, t.windowMinutes];
  if (numbers.some((n) => !Number.isFinite(n))) return "Informe números válidos nos campos de queda e janela.";

  if (t.maxBalanceDropPct < MIN_DROP_PCT || t.criticalBalanceDropPct > 100) {
    return `A queda de saldo deve ficar entre ${MIN_DROP_PCT}% e 100%.`;
  }
  if (t.maxBalanceDropPct >= t.criticalBalanceDropPct) {
    return "O limite de ligação (crítico) precisa ser maior que o limite de e-mail (aviso).";
  }
  if (!Number.isInteger(t.windowMinutes) || t.windowMinutes < MIN_WINDOW_MINUTES || t.windowMinutes > MAX_WINDOW_MINUTES) {
    return `A janela deve ser um número inteiro de minutos entre ${MIN_WINDOW_MINUTES} e ${MAX_WINDOW_MINUTES}.`;
  }
  if (t.blockedTransferAlertThreshold < 0n) return "O valor de transferência bloqueada não pode ser negativo.";
  if (t.blockedTransferAlertThreshold >= t.criticalBlockedTransferThreshold) {
    return "O valor crítico de transferência bloqueada precisa ser maior que o valor de aviso.";
  }
  return null;
}
