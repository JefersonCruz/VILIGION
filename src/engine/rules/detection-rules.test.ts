import { describe, expect, it } from "vitest";
import {
  checkBalanceDrop,
  checkBlockedTransfer,
  type UserThresholds,
} from "./detection-rules.js";
import type { BalanceSnapshot } from "../chains/evm-adapter.js";
import type { TransferBlockedEvent } from "../chains/tempo.adapter.js";

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

  it("transferência bloqueada abaixo do limiar crítico vira severidade normal", () => {
    const blocked: TransferBlockedEvent = {
      token: ADDR,
      receiver: ADDR,
      blockedNonce: 1n,
      amount: 5_000_000n, // acima do piso (1_000_000), abaixo do crítico (10_000_000)
      receiptVersion: 1,
      receipt: "0x00",
      receiptDecoded: {
        version: 1,
        token: ADDR,
        recoveryAuthority: ADDR,
        originator: ADDR,
        recipient: ADDR,
        blockedAt: 0n,
        blockedNonce: 1n,
        blockedReason: "receivePolicy",
        kind: "transfer",
        memo: "0x00",
      },
      blockNumber: 1n,
      transactionHash: "0x00",
    };

    const event = checkBlockedTransfer(blocked, thresholds);

    expect(event?.severity).toBe("normal");
  });

  it("transferência bloqueada acima do limiar crítico vira severidade critical", () => {
    const blocked: TransferBlockedEvent = {
      token: ADDR,
      receiver: ADDR,
      blockedNonce: 1n,
      amount: 20_000_000n, // acima do crítico (10_000_000)
      receiptVersion: 1,
      receipt: "0x00",
      receiptDecoded: {
        version: 1,
        token: ADDR,
        recoveryAuthority: ADDR,
        originator: ADDR,
        recipient: ADDR,
        blockedAt: 0n,
        blockedNonce: 1n,
        blockedReason: "receivePolicy",
        kind: "transfer",
        memo: "0x00",
      },
      blockNumber: 1n,
      transactionHash: "0x00",
    };

    const event = checkBlockedTransfer(blocked, thresholds);

    expect(event?.severity).toBe("critical");
  });
});
