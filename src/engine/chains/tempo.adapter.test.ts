import { describe, expect, it } from "vitest";
import { type Address, type Log, encodeAbiParameters, pad, toEventSelector } from "viem";
import { FEE_MANAGER_ADDRESS, TempoAdapter } from "./tempo.adapter.js";

const GUARD_ADDRESS = "0xB10C000000000000000000000000000000000000" as Address;
const TOKEN_ADDRESS = "0x2000000000000000000000000000000000000000" as Address;
const WATCHED_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

const TRANSFER_TOPIC0 = toEventSelector("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Monta um log de Transfer "cru" (topics/data), sem depender de um encoder de alto nível - equivalente ao que viem decodeEventLog espera receber de verdade da RPC. */
function transferLog(from: Address, to: Address, value: bigint): Log {
  return {
    address: TOKEN_ADDRESS,
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    topics: [TRANSFER_TOPIC0, pad(from), pad(to)],
    blockNumber: 2n,
    transactionHash: "0x00",
    blockHash: "0x00",
    logIndex: 0,
    transactionIndex: 0,
    removed: false,
  } as Log;
}

/** TempoAdapter falso - devolve logs pré-programados sem tocar RPC de verdade. */
class FakeTempoAdapter extends TempoAdapter {
  constructor(private readonly logs: Log[]) {
    super({
      rpcUrl: "http://localhost:1",
      chainId: 1,
      minConfirmations: 1,
      receivePolicyGuardAddress: GUARD_ADDRESS,
      tokenAddress: TOKEN_ADDRESS,
    });
  }

  override async getConfirmedLogs(): Promise<Log[]> {
    return this.logs;
  }
}

describe("TempoAdapter.getFeeAdjustment", () => {
  it("soma pagamentos de taxa (Transfer pro FeeManager) como ajuste positivo", async () => {
    const adapter = new FakeTempoAdapter([transferLog(WATCHED_ADDRESS, FEE_MANAGER_ADDRESS, 1_000n)]);

    expect(await adapter.getFeeAdjustment(1n, 2n, WATCHED_ADDRESS)).toBe(1_000n);
  });

  it("subtrai reembolso (Transfer do FeeManager de volta) do total de taxa paga", async () => {
    const adapter = new FakeTempoAdapter([
      transferLog(WATCHED_ADDRESS, FEE_MANAGER_ADDRESS, 1_000n),
      transferLog(FEE_MANAGER_ADDRESS, WATCHED_ADDRESS, 300n),
    ]);

    expect(await adapter.getFeeAdjustment(1n, 2n, WATCHED_ADDRESS)).toBe(700n);
  });

  it("ignora Transfer de valor real (não envolve o FeeManager) - não é taxa", async () => {
    const outro = "0x1111111111111111111111111111111111111111" as Address;
    const adapter = new FakeTempoAdapter([transferLog(WATCHED_ADDRESS, outro, 5_000n)]);

    expect(await adapter.getFeeAdjustment(1n, 2n, WATCHED_ADDRESS)).toBe(0n);
  });

  it("sem logs, ajuste é zero", async () => {
    const adapter = new FakeTempoAdapter([]);
    expect(await adapter.getFeeAdjustment(1n, 2n, WATCHED_ADDRESS)).toBe(0n);
  });

  it("fromBlock >= toBlock (mesmo bloco, nada novo) devolve zero sem consultar logs", async () => {
    const adapter = new FakeTempoAdapter([transferLog(WATCHED_ADDRESS, FEE_MANAGER_ADDRESS, 1_000n)]);
    expect(await adapter.getFeeAdjustment(2n, 2n, WATCHED_ADDRESS)).toBe(0n);
  });
});
