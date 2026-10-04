import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { TempoAdapter, type TransferBlockedEvent } from "./tempo.adapter.js";
import { TempoBlockedTransferExtension } from "./tempo-extension.js";
import type { UserThresholds } from "../rules/detection-rules.js";

const GUARD_ADDRESS = "0xB10C000000000000000000000000000000000000" as Address;

/** TempoAdapter falso - devolve eventos TransferBlocked pré-programados, nunca toca rede. */
class FakeTempoAdapter extends TempoAdapter {
  /** Guarda os argumentos da última chamada - usado pra provar que checkExtra repassa fromBlock/toBlock, não recalcula nada. */
  lastCall: { fromBlock: bigint; toBlock: bigint } | null = null;

  constructor(private readonly events: TransferBlockedEvent[]) {
    super({ rpcUrl: "http://localhost:1", chainId: 1, minConfirmations: 1, receivePolicyGuardAddress: GUARD_ADDRESS });
  }

  override async getBlockedTransfers(fromBlock: bigint, toBlock: bigint): Promise<TransferBlockedEvent[]> {
    this.lastCall = { fromBlock, toBlock };
    return this.events;
  }
}

const thresholds: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 20,
  criticalBalanceDropPct: 50,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 1_000_000n,
  criticalBlockedTransferThreshold: 10_000_000n,
};

function makeEvent(amount: bigint): TransferBlockedEvent {
  const addr = "0x0000000000000000000000000000000000dEaD" as Address;
  return {
    token: addr,
    receiver: addr,
    blockedNonce: 1n,
    amount,
    receiptVersion: 1,
    receipt: "0x00",
    receiptDecoded: {
      version: 1,
      token: addr,
      recoveryAuthority: addr,
      originator: addr,
      recipient: addr,
      blockedAt: 0n,
      blockedNonce: 1n,
      blockedReason: "receivePolicy",
      kind: "transfer",
      memo: "0x0000000000000000000000000000000000000000000000000000000000000000",
    },
    blockNumber: 1n,
    transactionHash: "0x00",
  };
}

describe("TempoBlockedTransferExtension", () => {
  it("converte transferências bloqueadas acima do limiar em DetectionEvent", async () => {
    const adapter = new FakeTempoAdapter([makeEvent(2_000_000n)]);
    const extension = new TempoBlockedTransferExtension(adapter);

    const events = await extension.checkExtra(1n, 10n, thresholds);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("transfer-blocked");
  });

  it("filtra transferências abaixo do limiar do usuário", async () => {
    const adapter = new FakeTempoAdapter([makeEvent(100n)]); // bem abaixo do limiar de 1_000_000n
    const extension = new TempoBlockedTransferExtension(adapter);

    const events = await extension.checkExtra(1n, 10n, thresholds);

    expect(events).toHaveLength(0);
  });

  it("sem eventos bloqueados, retorna lista vazia", async () => {
    const adapter = new FakeTempoAdapter([]);
    const extension = new TempoBlockedTransferExtension(adapter);

    const events = await extension.checkExtra(1n, 10n, thresholds);

    expect(events).toHaveLength(0);
  });

  it("repassa fromBlock/toBlock pro adaptador tal como recebeu - não deixa o adaptador recalcular o bloco confirmado (achado de performance de 2026-10-03)", async () => {
    const adapter = new FakeTempoAdapter([]);
    const extension = new TempoBlockedTransferExtension(adapter);

    await extension.checkExtra(5n, 42n, thresholds);

    expect(adapter.lastCall).toEqual({ fromBlock: 5n, toBlock: 42n });
  });
});
