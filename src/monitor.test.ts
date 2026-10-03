import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { Monitor } from "./monitor.js";
import { EvmAdapter, type BalanceSnapshot } from "./engine/chains/evm-adapter.js";
import type { ChainExtension } from "./engine/chain-extension.js";
import type { DetectionEvent, UserThresholds } from "./engine/rules/detection-rules.js";

const TEST_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

/** Adapter falso - nunca toca rede de verdade, só devolve saldos pré-programados em sequência. */
class FakeAdapter extends EvmAdapter {
  private callIndex = 0;

  constructor(private readonly balances: bigint[]) {
    super({ rpcUrl: "http://localhost:1", chainId: 1, minConfirmations: 1 });
  }

  async getBalance(address: Address): Promise<BalanceSnapshot> {
    const raw = this.balances[Math.min(this.callIndex, this.balances.length - 1)] ?? 0n;
    this.callIndex++;
    return { address, raw, blockNumber: 1n, observedAt: new Date() };
  }

  async getConfirmedBlockNumber(): Promise<bigint> {
    return 1n;
  }
}

class FakeExtension implements ChainExtension {
  calls = 0;
  constructor(private readonly events: DetectionEvent[]) {}

  async checkExtra(): Promise<DetectionEvent[]> {
    this.calls++;
    return this.events;
  }
}

const thresholds: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 20,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 1n,
};

describe("Monitor", () => {
  it("funciona sem extensão nenhuma (chain EVM genérica, sem particularidade de protocolo)", async () => {
    const adapter = new FakeAdapter([1000n, 1000n, 1000n]);
    const dispatched: DetectionEvent[] = [];
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async (e) => { dispatched.push(e); },
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 30));
    monitor.stop();
    await run;

    expect(dispatched).toHaveLength(0);
  });

  it("detecta queda de saldo acima do limiar e dispara alerta", async () => {
    const adapter = new FakeAdapter([1000n, 1000n, 700n]); // queda de 30% no 3º ciclo
    const dispatched: DetectionEvent[] = [];
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async (e) => { dispatched.push(e); },
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 40));
    monitor.stop();
    await run;

    expect(dispatched.some((e) => e.kind === "balance-drop")).toBe(true);
  });

  it("com extensão: chama checkExtra e despacha os eventos extras", async () => {
    const adapter = new FakeAdapter([1000n, 1000n]);
    const extraEvent: DetectionEvent = {
      kind: "transfer-blocked",
      userId: "u1",
      amount: 5_000_000n,
      blockedNonce: 1n,
    };
    const extension = new FakeExtension([extraEvent]);
    const dispatched: DetectionEvent[] = [];
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async (e) => { dispatched.push(e); },
      extension,
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 30));
    monitor.stop();
    await run;

    expect(dispatched).toContainEqual(extraEvent);
  });

  it("extensão só é consultada uma vez por bloco confirmado novo, não a cada ciclo de poll", async () => {
    const adapter = new FakeAdapter([1000n, 1000n, 1000n, 1000n]);
    const extension = new FakeExtension([]);
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async () => {},
      extension,
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 40)); // várias voltas do loop, mas o bloco confirmado nunca muda (sempre 1n)
    monitor.stop();
    await run;

    expect(extension.calls).toBe(1);
  });
});
