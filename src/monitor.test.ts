import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { Monitor } from "./monitor.js";
import { EvmAdapter, type BalanceSnapshot } from "./engine/chains/evm-adapter.js";
import type { ChainExtension } from "./engine/chain-extension.js";
import type { DetectionEvent, UserThresholds } from "./engine/rules/detection-rules.js";

const TEST_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

/**
 * Adapter falso - nunca toca rede de verdade, só devolve saldos e blocos
 * confirmados pré-programados em sequência. `confirmedBlocks` é opcional -
 * sem ele, fica fixo em 1n (suficiente pros testes que não olham a extensão).
 */
class FakeAdapter extends EvmAdapter {
  private callIndex = 0;
  private blockCallIndex = 0;

  constructor(
    private readonly balances: bigint[],
    private readonly confirmedBlocks: bigint[] = [1n],
  ) {
    super({ rpcUrl: "http://localhost:1", chainId: 1, minConfirmations: 1 });
  }

  async getBalance(address: Address): Promise<BalanceSnapshot> {
    const raw = this.balances[Math.min(this.callIndex, this.balances.length - 1)] ?? 0n;
    this.callIndex++;
    return { address, raw, blockNumber: 1n, observedAt: new Date() };
  }

  async getConfirmedBlockNumber(): Promise<bigint> {
    const block = this.confirmedBlocks[Math.min(this.blockCallIndex, this.confirmedBlocks.length - 1)] ?? 1n;
    this.blockCallIndex++;
    return block;
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

  it("primeiro ciclo NUNCA consulta a extensão - só estabelece o bloco atual como ponto de partida (achado de produção 2026-10-07)", async () => {
    // Bloco bem alto, do tamanho real da Tempo hoje - se o monitor tentasse
    // ler do bloco 1 em diante aqui, seria exatamente o bug visto em
    // produção (eth_getLogs rejeitado por exceder o range máximo do RPC).
    // Com a correção, o primeiro ciclo não chama a extensão nenhuma vez.
    const adapter = new FakeAdapter([1000n, 1000n], [42_629_110n, 42_629_110n, 42_629_110n]);
    const extension = new FakeExtension([]);
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async () => {},
      extension,
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 30));
    monitor.stop();
    await run;

    expect(extension.calls).toBe(0);
  });

  it("com extensão: no ciclo em que um bloco novo aparece, chama checkExtra e despacha os eventos extras", async () => {
    // 1º ciclo (bloco 1n) só estabelece a base; 2º ciclo em diante (bloco 2n) dispara a checagem de verdade.
    const adapter = new FakeAdapter([1000n, 1000n, 1000n], [1n, 2n, 2n, 2n]);
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
    await new Promise((r) => setTimeout(r, 40));
    monitor.stop();
    await run;

    expect(dispatched).toContainEqual(extraEvent);
  });

  it("repassa pra extensão o bloco confirmado que ACABOU de calcular, em vez de deixá-la recalcular (achado de performance de 2026-10-03)", async () => {
    // Baseline no bloco 50n (1º ciclo), bloco confirmado sobe pra 99n a partir do 2º ciclo.
    const adapter = new FakeAdapter([1000n, 1000n, 1000n], [50n, 99n, 99n]);
    const extension = new FakeExtension([]);
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async () => {},
      extension,
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 30));
    monitor.stop();
    await run;

    expect(extension.lastCall).toEqual({ fromBlock: 51n, toBlock: 99n });
  });

  it("extensão só é consultada uma vez por bloco confirmado novo, não a cada ciclo de poll", async () => {
    // Baseline no bloco 1n, sobe pra 5n e fica parada lá pelo resto dos ciclos.
    const adapter = new FakeAdapter([1000n, 1000n, 1000n, 1000n, 1000n], [1n, 5n, 5n, 5n, 5n]);
    const extension = new FakeExtension([]);
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async () => {},
      extension,
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 50)); // várias voltas do loop, mas o bloco confirmado só muda uma vez
    monitor.stop();
    await run;

    expect(extension.calls).toBe(1);
  });

  it("limita o range da consulta ao MAX_LOG_RANGE_BLOCKS quando o gap entre ciclos é grande demais (RPC fora do ar por horas, por exemplo)", async () => {
    // Baseline no bloco 10n; de repente o bloco confirmado salta 200.000 blocos à frente
    // num só ciclo - bem acima do limite de range que o RPC aceita numa consulta.
    const farAhead = 10n + 200_000n;
    const adapter = new FakeAdapter([1000n, 1000n, 1000n], [10n, farAhead, farAhead]);
    const extension = new FakeExtension([]);
    const monitor = new Monitor(
      adapter,
      { address: TEST_ADDRESS, thresholds, pollIntervalMs: 5 },
      async () => {},
      extension,
    );

    const run = monitor.start();
    await new Promise((r) => setTimeout(r, 30));
    monitor.stop();
    await run;

    expect(extension.lastCall).not.toBeNull();
    // toBlock sempre é o bloco confirmado real; fromBlock é recuado só até o limite do range, não até 11n.
    expect(extension.lastCall?.toBlock).toBe(farAhead);
    expect(extension.lastCall!.toBlock - extension.lastCall!.fromBlock).toBeLessThanOrEqual(50_000n);
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
