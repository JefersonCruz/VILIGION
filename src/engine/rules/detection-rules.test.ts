import { describe, expect, it } from "vitest";
import {
  checkBalanceDrop,
  checkRestrictedTransfer,
  type UserThresholds,
} from "./detection-rules.js";
import type { BalanceSnapshot } from "../chains/chain-adapter.js";
import type { RestrictedTransferObservation } from "./normalized-events.js";

const ADDR = "0x0000000000000000000000000000000000dEaD" as const;

const thresholds: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 20,
  criticalBalanceDropPct: 50,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 1_000_000n,
  criticalBlockedTransferThreshold: 10_000_000n,
};

function snapshot(raw: bigint, observedAt = new Date()): BalanceSnapshot {
  return { address: ADDR, raw, blockNumber: 1n, observedAt };
}

/**
 * Observação normalizada, sem nenhum campo de rede específica.
 *
 * Este helper é a evidência do desacoplamento desta etapa: antes, testar a
 * regra GENÉRICA de transferência restringida exigia montar um
 * `TransferBlockedEvent` completo da Tempo - com witness ClaimReceiptV1,
 * `receiptVersion`, `blockedReason` e endereço do Guard - uns 20 campos de
 * uma rede só, pra exercitar uma função que só olha `amount`. A tradução do
 * evento real da Tempo pra esta forma é testada onde ela mora, em
 * chains/tempo-extension.test.ts.
 */
function restricted(amount: bigint): RestrictedTransferObservation {
  return {
    kind: "transfer-restricted",
    chainKey: "rede-de-teste",
    cursor: 1n,
    sequence: 1n,
    amount,
  };
}

describe("severidade do alerta - decide o canal de entrega (ligação vs e-mail)", () => {
  it("queda de saldo entre o limiar normal e o crítico vira severidade normal (e-mail)", () => {
    const previous = snapshot(1000n, new Date(0));
    const current = snapshot(750n, new Date(1000)); // 25% - acima de 20%, abaixo de 50%

    const event = checkBalanceDrop(previous, current, thresholds);

    expect(event?.severity).toBe("normal");
  });

  it("queda de saldo acima do limiar crítico vira severidade critical (ligação)", () => {
    const previous = snapshot(1000n, new Date(0));
    const current = snapshot(400n, new Date(1000)); // 60% - acima de 50%

    const event = checkBalanceDrop(previous, current, thresholds);

    expect(event?.severity).toBe("critical");
  });

  it("transferência restringida abaixo do limiar crítico vira severidade normal", () => {
    // acima do piso (1_000_000), abaixo do crítico (10_000_000)
    const event = checkRestrictedTransfer(restricted(5_000_000n), thresholds);

    expect(event?.severity).toBe("normal");
  });

  it("transferência restringida acima do limiar crítico vira severidade critical", () => {
    const event = checkRestrictedTransfer(restricted(20_000_000n), thresholds);

    expect(event?.severity).toBe("critical");
  });

  it("transferência restringida abaixo do piso do usuário não gera alerta nenhum", () => {
    expect(checkRestrictedTransfer(restricted(999_999n), thresholds)).toBeNull();
  });

  it("a regra genérica não precisa de nenhum campo de rede específica - só amount e sequence", () => {
    // Guarda de regressão do desacoplamento: se alguém voltar a exigir um
    // campo da Tempo (receipt, guard, token) em checkRestrictedTransfer, esta
    // observação mínima deixa de compilar/passar e o acoplamento reaparece
    // visível, em vez de voltar silenciosamente.
    const event = checkRestrictedTransfer(
      { kind: "transfer-restricted", chainKey: "x", cursor: 0n, sequence: 42n, amount: 2_000_000n },
      thresholds,
    );

    expect(event).toEqual({
      kind: "transfer-blocked",
      userId: "u1",
      amount: 2_000_000n,
      blockedNonce: 42n,
      severity: "normal",
    });
  });
});
