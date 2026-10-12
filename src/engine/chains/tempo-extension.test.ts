import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { TempoAdapter, type TransferBlockedEvent } from "./tempo.adapter.js";
import { TempoBlockedTransferExtension, toRestrictedTransferObservation } from "./tempo-extension.js";
import { checkRestrictedTransfer, type UserThresholds } from "../rules/detection-rules.js";

const GUARD_ADDRESS = "0xB10C000000000000000000000000000000000000" as Address;
/**
 * Obrigatório desde que TempoAdapter passou a validar a própria configuração
 * no construtor: a Tempo não tem gas token nativo, então um adaptador sem
 * endereço de token leria um saldo que não é o da tesouraria (ver
 * TEMPO_CAPABILITIES). Mesmo um adaptador falso, que nunca lê saldo, precisa
 * ser configurado de forma válida - um fake que aceita configuração que a
 * produção rejeita é um fake que testa outra coisa.
 */
const TOKEN_ADDRESS = "0x0000000000000000000000000000000000000001" as Address;

/** TempoAdapter falso - devolve eventos TransferBlocked pré-programados, nunca toca rede. */
class FakeTempoAdapter extends TempoAdapter {
  /** Guarda os argumentos da última chamada - usado pra provar que checkExtra repassa fromBlock/toBlock, não recalcula nada. */
  lastCall: { fromBlock: bigint; toBlock: bigint } | null = null;

  constructor(private readonly events: TransferBlockedEvent[]) {
    super({
      rpcUrl: "http://localhost:1",
      chainId: 1,
      minConfirmations: 1,
      receivePolicyGuardAddress: GUARD_ADDRESS,
      tokenAddress: TOKEN_ADDRESS,
    });
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

describe("tradução do evento da Tempo pra observação normalizada", () => {
  /**
   * Esta é a camada que substituiu o import de `TransferBlockedEvent` dentro
   * de detection-rules.ts. A regra genérica agora só vê `amount`/`sequence`;
   * tudo que é do TIP-403 fica preservado em `details`, pra auditoria, sem
   * virar campo do núcleo.
   */
  it("mapeia os campos genéricos: valor, sequência, cursor e referência da transação", () => {
    const observation = toRestrictedTransferObservation(makeEvent(3_000_000n));

    expect(observation.kind).toBe("transfer-restricted");
    expect(observation.chainKey).toBe("tempo");
    expect(observation.amount).toBe(3_000_000n);
    expect(observation.sequence).toBe(1n); // blockedNonce do TIP-403
    expect(observation.cursor).toBe(1n); // blockNumber
    expect(observation.txRef).toBe("0x00");
  });

  it("preserva o witness decodificado em details, pra auditoria, sem promovê-lo a campo genérico", () => {
    const observation = toRestrictedTransferObservation(makeEvent(3_000_000n));
    const details = observation.details as Record<string, unknown>;

    expect(details.protocolEvent).toBe("tempo/TransferBlocked");
    expect(details.receiptDecoded).toMatchObject({ blockedReason: "receivePolicy", kind: "transfer" });
    // Os campos do TIP-403 NÃO vazam pro nível de cima do modelo normalizado.
    expect(observation).not.toHaveProperty("receiptDecoded");
    expect(observation).not.toHaveProperty("blockedNonce");
    expect(observation).not.toHaveProperty("receiver");
  });

  it("a severidade sai só do valor contra os limiares - nada vindo de details a influencia", () => {
    // `details` carrega dado da cadeia, ou seja, dado que quem ataca a conta
    // também consegue influenciar (o memo, por exemplo, vem de quem originou
    // a transferência). Dois eventos de mesmo valor precisam dar a mesma
    // severidade independente do que venha no recibo. Ver SECURITY.md.
    const base = makeEvent(2_000_000n);
    const withHostileMemo: TransferBlockedEvent = {
      ...base,
      receiptDecoded: { ...base.receiptDecoded, blockedReason: "tokenFilter", memo: "0xdead" },
    };

    const a = checkRestrictedTransfer(toRestrictedTransferObservation(base), thresholds);
    const b = checkRestrictedTransfer(toRestrictedTransferObservation(withHostileMemo), thresholds);

    expect(a?.severity).toBe("normal");
    expect(b?.severity).toBe("normal");
  });
});
