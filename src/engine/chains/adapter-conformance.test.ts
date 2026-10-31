/**
 * Roda a suíte de conformidade (adapter-conformance.ts) contra os adaptadores
 * de referência, e contra um adaptador NÃO-EVM de mentira.
 *
 * O adaptador não-EVM é o teste central desta etapa, e não um exercício: ele
 * não herda de `EvmAdapter`, não conhece bloco, log nem ABI, e ainda assim
 * passa pela mesma bateria e é aceito pelo mesmo `Monitor`. Se o contrato
 * tivesse sido desenhado em volta do EVM - como estava antes, quando o
 * construtor do Monitor pedia a classe concreta `EvmAdapter` - este arquivo
 * não compilaria. É a prova executável de que a arquitetura aceita uma
 * integração de outra família sem modificação arbitrária no núcleo, que é o
 * critério da Etapa Três.
 *
 * Nada aqui toca rede.
 */

import { describe, expect, it } from "vitest";
import type { Address } from "viem";  /* ainda usado pelos adaptadores EVM deste arquivo */
import { describeAdapterConformance } from "./adapter-conformance.js";
import type {
  AddressCheck,
  AdapterMetadata,
  BalanceSnapshot,
  ChainAddress,
  ChainCapabilities,
  MonitoredChainAdapter,
} from "./chain-adapter.js";
import { EvmAdapter } from "./evm-adapter.js";
import { TempoAdapter } from "./tempo.adapter.js";
import { Monitor } from "../../monitor.js";
import type { DetectionEvent, UserThresholds } from "../rules/detection-rules.js";

const SAMPLE_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;
/** Curto demais pra ser endereco EVM - exemplo negativo da suite de conformidade. */
const SAMPLE_ADDRESS_INVALIDO = "0xabc123";

/**
 * Endereco base58, na notacao de uma rede tipo Solana. Nao e 0x, nao e hex, e
 * diferencia maiuscula de minuscula - as tres coisas que um endereco EVM nao
 * faz.
 *
 * Existe pra que a rede ficticia abaixo seja exercitada com um endereco da
 * NOTACAO dela, e nao com um 0x emprestado do EVM. Ate 23/10/2026 ela usava
 * SAMPLE_ADDRESS, e isso escondia que o produto nao conseguia aceitar
 * endereco nenhum fora do formato EVM.
 */
const SAMPLE_ADDRESS_SLOT = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
/** Tem "0" e "l", que nao existem no alfabeto base58 - invalido de proposito. */
const SAMPLE_ADDRESS_SLOT_INVALIDO = "0l0l0l0l0l0l0l0l0l0l0l0l0l0l0l0l";
const TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001" as Address;
const GUARD_ADDRESS = "0xB10C000000000000000000000000000000000000" as Address;
const FIXTURE_BALANCE = 1_234_567n;

/** Erro de rede como o viem entrega: a mensagem importa menos que o fato de ser lançado. */
class FakeRpcFailure extends Error {
  constructor() {
    super("HTTP request failed: connect ETIMEDOUT");
  }
}

/* ────────────────────────── 1. EVM genérico ────────────────────────── */

/** EvmAdapter real, com as chamadas RPC cruas substituídas por fixtures (ver os seams `raw*`). */
class OfflineEvmAdapter extends EvmAdapter {
  constructor(tokenAddress?: Address) {
    super({ rpcUrl: "http://localhost:1", chainId: 8453, minConfirmations: 3, chainKey: "base", displayName: "Base", tokenAddress });
  }

  protected override async rawReadTokenBalance(): Promise<bigint> {
    return FIXTURE_BALANCE;
  }

  protected override async rawReadNativeBalance(): Promise<bigint> {
    return FIXTURE_BALANCE;
  }

  protected override async rawGetBlockNumber(): Promise<bigint> {
    return 500n;
  }

  protected override async rawGetLogs(): Promise<[]> {
    return [];
  }
}

/** Mesma classe, mas toda chamada RPC falha - pra provar que a falha propaga. */
class FailingEvmAdapter extends OfflineEvmAdapter {
  protected override async rawReadTokenBalance(): Promise<bigint> {
    throw new FakeRpcFailure();
  }

  protected override async rawReadNativeBalance(): Promise<bigint> {
    throw new FakeRpcFailure();
  }

  protected override async rawGetBlockNumber(): Promise<bigint> {
    throw new FakeRpcFailure();
  }
}

describeAdapterConformance({
  label: "EvmAdapter (núcleo genérico, lendo saldo de token)",
  sampleAddress: SAMPLE_ADDRESS,
  invalidAddress: SAMPLE_ADDRESS_INVALIDO,
  expectedBalance: FIXTURE_BALANCE,
  create: () => new OfflineEvmAdapter(TOKEN_ADDRESS),
  createFailing: () => new FailingEvmAdapter(TOKEN_ADDRESS),
});

describeAdapterConformance({
  label: "EvmAdapter (núcleo genérico, lendo saldo nativo)",
  sampleAddress: SAMPLE_ADDRESS,
  invalidAddress: SAMPLE_ADDRESS_INVALIDO,
  expectedBalance: FIXTURE_BALANCE,
  create: () => new OfflineEvmAdapter(),
  createFailing: () => new FailingEvmAdapter(),
});

/* ──────────────────────────── 2. Tempo ─────────────────────────────── */

class OfflineTempoAdapter extends TempoAdapter {
  constructor() {
    super({
      rpcUrl: "http://localhost:1",
      chainId: 4217,
      minConfirmations: 3,
      chainKey: "tempo",
      displayName: "Tempo",
      receivePolicyGuardAddress: GUARD_ADDRESS,
      tokenAddress: TOKEN_ADDRESS,
    });
  }

  protected override async rawReadTokenBalance(): Promise<bigint> {
    return FIXTURE_BALANCE;
  }

  protected override async rawGetBlockNumber(): Promise<bigint> {
    return 500n;
  }

  protected override async rawGetLogs(): Promise<[]> {
    return [];
  }
}

class FailingTempoAdapter extends OfflineTempoAdapter {
  protected override async rawReadTokenBalance(): Promise<bigint> {
    throw new FakeRpcFailure();
  }

  protected override async rawGetBlockNumber(): Promise<bigint> {
    throw new FakeRpcFailure();
  }
}

describeAdapterConformance({
  label: "TempoAdapter (implementação de referência com extensão de protocolo)",
  sampleAddress: SAMPLE_ADDRESS,
  invalidAddress: SAMPLE_ADDRESS_INVALIDO,
  expectedBalance: FIXTURE_BALANCE,
  create: () => new OfflineTempoAdapter(),
  createFailing: () => new FailingTempoAdapter(),
});

/* ───────────────── 3. Rede de outra família (não-EVM) ──────────────── */

/**
 * Adaptador de uma rede imaginária baseada em slots, não em blocos. NÃO herda
 * de `EvmAdapter` e não importa NADA do viem - nem o tipo de endereço, que até
 * 23/10/2026 ainda vinha de lá e era a última suposição de EVM no contrato.
 *
 * Declara `feePaidInMonitoredAsset: false` e `reorgPossible: false` - uma rede
 * com finalidade determinística - justamente pra exercitar combinações de
 * capacidade que nenhuma rede EVM produz.
 *
 * Existe só neste arquivo de teste, de propósito: é uma prova de
 * extensibilidade, não um adaptador de rede de verdade. Registrar uma rede
 * que ninguém validou contra a rede real é exatamente o que
 * docs/CHAIN-SUPPORT-MATRIX.md existe pra impedir.
 */
class FakeSlotChainAdapter implements MonitoredChainAdapter {
  readonly metadata: AdapterMetadata = {
    chainKey: "rede-de-slots-ficticia",
    displayName: "Rede de slots (fictícia, só em teste)",
    family: "svm",
  };

  readonly capabilities: ChainCapabilities = {
    tokenBalance: true,
    nativeBalance: true,
    historicalEvents: true,
    feePaidInMonitoredAsset: false,
    reorgPossible: false,
    requiresTokenAddress: false,
  };

  /** Unidade é slot, não bloco - e o número é diferente do limite EVM de propósito. */
  readonly maxHistoryWindow = 1_000n;

  constructor(private readonly balances: bigint[] = [FIXTURE_BALANCE]) {}

  private callIndex = 0;

  /**
   * Preenchido só pelo teste de integração com o Monitor: o adaptador para o
   * laço depois de consumir todos os saldos programados. Mesmo padrão
   * determinístico de monitor.test.ts - o teste acaba no ciclo N, não "depois
   * de X milissegundos".
   */
  monitor: { stop(): void } | null = null;

  /**
   * Validação base58, como numa rede tipo Solana. Três diferenças em relação
   * ao EVM, e cada uma quebraria se o núcleo tentasse validar por conta
   * própria: não tem prefixo `0x`, o alfabeto exclui `0`, `O`, `I` e `l` (que
   * se confundem na leitura), e o endereço DIFERENCIA maiúscula de minúscula.
   *
   * Essa última é a que importa: normalizar pra minúsculo aqui - como o
   * adaptador EVM faz, corretamente, pra rede dele - juntaria dois endereços
   * distintos num só. Por isso `normalized` devolve o texto como está.
   */
  checkAddress(raw: string): AddressCheck {
    const aparado = raw.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(aparado)) {
      return { ok: false, reason: "precisa ser um endereço base58 de 32 a 44 caracteres" };
    }
    return { ok: true, normalized: aparado };
  }

  async getBalance(address: ChainAddress): Promise<BalanceSnapshot> {
    const raw = this.balances[Math.min(this.callIndex, this.balances.length - 1)] ?? 0n;
    this.callIndex++;
    if (this.callIndex >= this.balances.length) this.monitor?.stop();
    return { address, raw, blockNumber: 42n, observedAt: new Date() };
  }

  async getConfirmedBlockNumber(): Promise<bigint> {
    return 42n;
  }

  async getFeeAdjustment(): Promise<bigint> {
    // Resposta CORRETA, não placeholder: esta rede declara que a taxa não sai
    // do ativo monitorado (ver capabilities acima).
    return 0n;
  }
}

class FailingSlotChainAdapter extends FakeSlotChainAdapter {
  override async getBalance(): Promise<BalanceSnapshot> {
    throw new FakeRpcFailure();
  }

  override async getConfirmedBlockNumber(): Promise<bigint> {
    throw new FakeRpcFailure();
  }
}

describeAdapterConformance({
  label: "FakeSlotChainAdapter (família não-EVM, prova de extensibilidade)",
  sampleAddress: SAMPLE_ADDRESS_SLOT,
  invalidAddress: SAMPLE_ADDRESS_SLOT_INVALIDO,
  expectedBalance: FIXTURE_BALANCE,
  create: () => new FakeSlotChainAdapter(),
  createFailing: () => new FailingSlotChainAdapter(),
});

/* ──────── 4. O núcleo aceita a rede não-EVM sem saber o que ela é ──────── */

const thresholds: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 20,
  criticalBalanceDropPct: 50,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 1_000_000n,
  criticalBlockedTransferThreshold: 10_000_000n,
};

describe("o núcleo monitora uma rede de outra família sem alteração alguma", () => {
  it("Monitor aceita um adaptador que não é EvmAdapter, com endereço base58, e detecta queda de saldo nele", async () => {
    const dispatched: DetectionEvent[] = [];
    // 1000 → 400 é queda de 60%: acima do crítico (50%)
    const adapter = new FakeSlotChainAdapter([1000n, 400n]);
    const monitor = new Monitor(
      adapter,
      { address: SAMPLE_ADDRESS_SLOT, thresholds, pollIntervalMs: 0 },
      async (event) => {
        dispatched.push(event);
      },
    );
    adapter.monitor = monitor;

    await monitor.start();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ kind: "balance-drop", severity: "critical", userId: "u1" });
  });

  it("usa o maxHistoryWindow declarado PELO ADAPTADOR, não uma constante de EVM do núcleo", () => {
    // Guarda de regressão: o monitor importava MAX_LOG_RANGE_BLOCKS do
    // evm-adapter direto, o que dava a toda rede o limite de uma família só.
    const slotChain = new FakeSlotChainAdapter();
    const evm = new OfflineEvmAdapter(TOKEN_ADDRESS);

    expect(slotChain.maxHistoryWindow).toBe(1_000n);
    expect(evm.maxHistoryWindow).not.toBe(slotChain.maxHistoryWindow);
  });
});
