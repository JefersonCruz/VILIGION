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

/** Como FakeAdapter, mas simula uma chain sem gas token nativo (Tempo): `fees[i]` é a taxa paga entre o ciclo i e o i+1. */
class FakeFeeChargingAdapter extends FakeAdapter {
  private feeCall = 0;
  constructor(balances: bigint[], private readonly fees: bigint[]) {
    super(balances);
  }

  override async getFeeAdjustment(): Promise<bigint> {
    return this.fees[this.feeCall++] ?? 0n;
  }
}

class FakeExtension implements ChainExtension {
  calls = 0;
  lastCall: { fromBlock: bigint; toBlock: bigint } | null = null;
  constructor(private readonly events: DetectionEvent[]) {}

  async checkExtra(fromBlock: bigint, toBlock: bigint): Promise<DetectionEvent[]> {
    this.calls++;
    this.lastCall = { fromBlock, toBlock };
    return this.events;
  }
}

const thresholds: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 20,
  criticalBalanceDropPct: 50,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 1n,
  criticalBlockedTransferThreshold: 10n,
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

  it("não dispara falso positivo quando a queda observada é só taxa (ex: Tempo, sem gas token nativo)", async () => {
    // mesma sequência de saldo do teste anterior (queda de 30%, dispararia alerta sem o ajuste)
    const adapter = new FakeFeeChargingAdapter([1000n, 1000n, 700n], [0n, 300n]); // delta de 300 é inteiramente taxa
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

    expect(dispatched.some((e) => e.kind === "balance-drop")).toBe(false);
  });

  it("com ajuste de taxa parcial, ainda detecta a parte real da queda acima do limiar", async () => {
    // saldo cai 1000 -> 700 (30%), mas só 50 disso é taxa - os outros 250 (25%) são saída real, ainda acima do limiar de 20%
    const adapter = new FakeFeeChargingAdapter([1000n, 1000n, 700n], [0n, 50n]);
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

    const event = dispatched.find((e) => e.kind === "balance-drop");
    expect(event).toBeDefined();
    expect(event && "pctDropped" in event ? event.pctDropped : null).toBeCloseTo(25, 1);
  });

  it("com extensão: chama checkExtra e despacha os eventos extras", async () => {
    const adapter = new FakeAdapter([1000n, 1000n]);
    const extraEvent: DetectionEvent = {
      kind: "transfer-blocked",
      userId: "u1",
      amount: 5_000_000n,
      blockedNonce: 1n,
      severity: "normal",
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

  it("repassa pra extensão o bloco confirmado que ACABOU de calcular, em vez de deixá-la recalcular (achado de performance de 2026-10-03)", async () => {
    class FakeAdapterAtBlock99 extends FakeAdapter {
      override async getConfirmedBlockNumber(): Promise<bigint> {
        return 99n;
      }
    }
    const adapter = new FakeAdapterAtBlock99([1000n, 1000n]);
    const extension = new FakeExtension([]);
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async () => {},
      extension,
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 15));
    monitor.stop();
    await run;

    expect(extension.lastCall).toEqual({ fromBlock: 1n, toBlock: 99n });
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

  it("edição de limiar vale no ciclo seguinte, sem reiniciar o monitor", async () => {
    let current: UserThresholds = { ...thresholds, maxBalanceDropPct: 90, criticalBalanceDropPct: 95 };
    const adapter = new FakeAdapter([1000n, 1000n, 700n, 700n, 400n]);
    const dispatched: DetectionEvent[] = [];
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds: async () => current, pollIntervalMs: 20 },
      async (e) => { dispatched.push(e); },
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 50)); // 30% de queda com limiar de 90%: nada dispara
    expect(dispatched).toHaveLength(0);
    current = { ...thresholds, maxBalanceDropPct: 10, criticalBalanceDropPct: 50 };
    await new Promise((r) => setTimeout(r, 100));
    monitor.stop();
    await run;

    expect(dispatched.some((e) => e.kind === "balance-drop")).toBe(true);
  });

  it("se a leitura dos limiares falha, segue com o último valor válido em vez de ficar sem proteção", async () => {
    let calls = 0;
    const source = async (): Promise<UserThresholds> => {
      calls++;
      if (calls > 1) throw new Error("banco fora do ar");
      return thresholds;
    };
    const adapter = new FakeAdapter([1000n, 1000n, 700n]);
    const dispatched: DetectionEvent[] = [];
    const monitor = new Monitor(adapter, { address: TEST_ADDRESS, thresholds: source, pollIntervalMs: 5 }, async (e) => { dispatched.push(e); });

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 40));
    monitor.stop();
    await run;

    expect(dispatched.some((e) => e.kind === "balance-drop")).toBe(true);
  });
});
