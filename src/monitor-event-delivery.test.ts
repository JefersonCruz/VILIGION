/**
 * Entrega de eventos de extensão: duplicados, fora de ordem e reentrega
 * depois de falha de ciclo.
 *
 * Separado de monitor.test.ts de propósito - lá o foco é detecção, janela e
 * health check; aqui é a GARANTIA DE ENTREGA, que é o que o dono da
 * tesouraria de fato experimenta. Um alerta a menos é uma falha de produto;
 * um alerta repetido também é, porque alerta que grita duas vezes pela mesma
 * coisa treina o usuário a ignorar o alerta - e no canal crítico cada
 * repetição é uma ligação telefônica de verdade, com custo e registro na
 * operadora (ver SECURITY.md).
 */

import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { EvmAdapter } from "./engine/chains/evm-adapter.js";
import type { BalanceSnapshot } from "./engine/chains/chain-adapter.js";
import { Monitor } from "./monitor.js";
import type { ChainExtension } from "./engine/chain-extension.js";
import type { DetectionEvent, UserThresholds } from "./engine/rules/detection-rules.js";

const ADDR = "0x000000000000000000000000000000000000dEaD" as Address;

const thresholds: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 20,
  criticalBalanceDropPct: 50,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 1_000_000n,
  criticalBlockedTransferThreshold: 10_000_000n,
};

/**
 * Saldo constante (nenhuma queda) e cursor avançando um por ciclo - isola a
 * entrega de eventos da extensão da detecção de queda de saldo.
 *
 * Para o monitor de dentro do próprio adaptador, no ciclo `stopAfterCycles`,
 * seguindo o mesmo padrão de monitor.test.ts: o teste termina exatamente no
 * ciclo N em vez de "depois de X milissegundos", que é o tipo de teste que
 * passa na máquina do dev e falha num runner de CI mais lento.
 */
class SteadyBalanceAdapter extends EvmAdapter {
  private tick = 0;
  monitor: Monitor | null = null;

  constructor(private readonly stopAfterCycles: number) {
    super({ rpcUrl: "http://localhost:1", chainId: 1, minConfirmations: 0 });
  }

  override async getBalance(address: Address): Promise<BalanceSnapshot> {
    this.tick++;
    if (this.tick >= this.stopAfterCycles) this.monitor?.stop();
    return super.getBalance(address);
  }

  protected override async rawReadNativeBalance(): Promise<bigint> {
    return 1_000n;
  }

  /** Cursor cresce 10 por ciclo: garante que cada ciclo veja bloco novo e consulte a extensão. */
  protected override async rawGetBlockNumber(): Promise<bigint> {
    return BigInt(this.tick * 10);
  }
}

function blockedEvent(sequence: bigint): DetectionEvent {
  return { kind: "transfer-blocked", userId: "u1", amount: 5_000_000n, blockedNonce: sequence, severity: "normal" };
}

/** Liga adaptador e monitor (o adaptador precisa da referência pra se parar) e roda até ele parar. */
async function runUntilStopped(adapter: SteadyBalanceAdapter, monitor: Monitor): Promise<void> {
  adapter.monitor = monitor;
  await monitor.start();
}

describe("entrega de eventos de extensão", () => {
  it("não reentrega um evento já entregue quando o ciclo falha no meio da leva", async () => {
    /**
     * O cenário real que isto cobre: a extensão devolve dois bloqueios no
     * mesmo intervalo de cursor. O primeiro é entregue; a entrega do segundo
     * falha (SMTP fora do ar, Twilio com erro). O erro sobe do `tick`, e por
     * isso `lastCheckedBlock` NÃO avança - comportamento correto, porque o
     * segundo evento ainda não chegou a ninguém e seria perdido pra sempre.
     *
     * A consequência indesejada é que o ciclo seguinte reconsulta o MESMO
     * intervalo e recebe os MESMOS dois eventos - incluindo o primeiro, que
     * já havia sido entregue. Sem desduplicação, o dono recebe duas ligações
     * pelo mesmo bloqueio.
     */
    const delivered: bigint[] = [];
    let failOnce = true;

    const extension: ChainExtension = {
      async checkExtra() {
        return [blockedEvent(1n), blockedEvent(2n)];
      },
    };

    const adapter = new SteadyBalanceAdapter(6);
    const monitor = new Monitor(
      adapter,
      { address: ADDR, thresholds, pollIntervalMs: 0 },
      async (event) => {
        if (event.kind !== "transfer-blocked") return;
        if (event.blockedNonce === 2n && failOnce) {
          failOnce = false;
          throw new Error("canal de entrega indisponível");
        }
        delivered.push(event.blockedNonce);
      },
      extension,
    );

    await runUntilStopped(adapter, monitor);

    // Cada bloqueio entregue exatamente uma vez: o nonce 1 não repete por
    // causa da reentrega do intervalo, e o nonce 2 chega na segunda tentativa.
    expect(delivered.filter((n) => n === 1n)).toHaveLength(1);
    expect(delivered.filter((n) => n === 2n)).toHaveLength(1);
  });

  it("entrega eventos fora de ordem de sequência sem descartar nenhum", async () => {
    // Provedor de RPC não garante ordem de log, e numa reorg a ordem muda.
    // O monitor não deve assumir sequência crescente pra decidir o que já viu.
    const delivered: bigint[] = [];
    const extension: ChainExtension = {
      async checkExtra() {
        return [blockedEvent(9n), blockedEvent(3n), blockedEvent(7n)];
      },
    };

    const adapter = new SteadyBalanceAdapter(3);
    const monitor = new Monitor(
      adapter,
      { address: ADDR, thresholds, pollIntervalMs: 0 },
      async (event) => {
        if (event.kind === "transfer-blocked") delivered.push(event.blockedNonce);
      },
      extension,
    );

    await runUntilStopped(adapter, monitor);

    expect([...delivered].sort((a, b) => Number(a - b))).toEqual([3n, 7n, 9n]);
  });

  it("o mesmo evento reaparecendo num intervalo posterior (reorg, log repetido) não gera segundo alerta", async () => {
    const delivered: bigint[] = [];
    const extension: ChainExtension = {
      // Sempre o mesmo evento, em todo intervalo consultado.
      async checkExtra() {
        return [blockedEvent(42n)];
      },
    };

    // cursor avançando a cada ciclo: força checkExtra a ser chamado várias vezes
    const adapter = new SteadyBalanceAdapter(6);
    const monitor = new Monitor(
      adapter,
      { address: ADDR, thresholds, pollIntervalMs: 0 },
      async (event) => {
        if (event.kind === "transfer-blocked") delivered.push(event.blockedNonce);
      },
      extension,
    );

    await runUntilStopped(adapter, monitor);

    expect(delivered).toEqual([42n]);
  });

  it("eventos distintos com a mesma sequência mas tipos diferentes não se desduplicam entre si", async () => {
    // Guarda contra uma chave de desduplicação frouxa demais: dois eventos de
    // tipos diferentes que por acaso compartilham o identificador são
    // ocorrências distintas e as duas precisam chegar.
    const delivered: DetectionEvent[] = [];
    const extension: ChainExtension = {
      async checkExtra() {
        return [
          blockedEvent(5n),
          { kind: "balance-drop", userId: "u1", pctDropped: 90, windowMinutes: 1, severity: "critical" },
        ];
      },
    };

    // 2 ciclos = exatamente UMA consulta à extensão (o 1o só estabelece o
    // cursor inicial). Importa porque balance-drop não é desduplicável de
    // propósito - num 2o ciclo ele seria entregue de novo, e corretamente.
    const adapter = new SteadyBalanceAdapter(2);
    const monitor = new Monitor(
      adapter,
      { address: ADDR, thresholds, pollIntervalMs: 0 },
      async (event) => {
        delivered.push(event);
      },
      extension,
    );

    await runUntilStopped(adapter, monitor);

    expect(delivered.map((e) => e.kind).sort()).toEqual(["balance-drop", "transfer-blocked"]);
  });
});
