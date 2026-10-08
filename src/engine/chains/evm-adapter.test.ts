import { describe, expect, it } from "vitest";
import type { Address, Log } from "viem";
import { EvmAdapter, MAX_LOG_RANGE_BLOCKS } from "./evm-adapter.js";

const TEST_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

/** Loga fake, uma por bloco pedido - suficiente pra conferir ordem/contagem sem precisar decodificar nada de verdade. */
function fakeLog(blockNumber: bigint): Log {
  return { blockNumber } as Log;
}

/** Subclasse que grava cada chamada de rawGetLogs, sem nunca tocar rede (ver nota em rawGetLogs sobre por que esse método existe isolado). */
class RecordingAdapter extends EvmAdapter {
  calls: Array<{ fromBlock: bigint; toBlock: bigint }> = [];

  constructor() {
    super({ rpcUrl: "http://localhost:1", chainId: 1, minConfirmations: 1 });
  }

  protected async rawGetLogs(params: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<Log[]> {
    this.calls.push({ fromBlock: params.fromBlock, toBlock: params.toBlock });
    return [fakeLog(params.fromBlock), fakeLog(params.toBlock)];
  }
}

describe("EvmAdapter.getConfirmedLogs", () => {
  it("range dentro do limite: uma chamada só, sem paginar", async () => {
    const adapter = new RecordingAdapter();
    const logs = await adapter.getConfirmedLogs({ address: TEST_ADDRESS, fromBlock: 10n, toBlock: 20n });

    expect(adapter.calls).toEqual([{ fromBlock: 10n, toBlock: 20n }]);
    expect(logs).toHaveLength(2);
  });

  it("range exatamente igual ao limite: ainda uma chamada só (sem paginar 1 bloco a mais do que precisa)", async () => {
    const adapter = new RecordingAdapter();
    const toBlock = 1n + MAX_LOG_RANGE_BLOCKS - 1n;
    await adapter.getConfirmedLogs({ address: TEST_ADDRESS, fromBlock: 1n, toBlock });

    expect(adapter.calls).toEqual([{ fromBlock: 1n, toBlock }]);
  });

  it("range um bloco maior que o limite: pagina em duas chamadas, cada uma dentro do limite do RPC", async () => {
    const adapter = new RecordingAdapter();
    const toBlock = 1n + MAX_LOG_RANGE_BLOCKS; // MAX_LOG_RANGE_BLOCKS + 1 blocos no total
    await adapter.getConfirmedLogs({ address: TEST_ADDRESS, fromBlock: 1n, toBlock });

    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[0]).toEqual({ fromBlock: 1n, toBlock: MAX_LOG_RANGE_BLOCKS });
    expect(adapter.calls[1]).toEqual({ fromBlock: MAX_LOG_RANGE_BLOCKS + 1n, toBlock });
    for (const call of adapter.calls) {
      expect(call.toBlock - call.fromBlock + 1n).toBeLessThanOrEqual(MAX_LOG_RANGE_BLOCKS);
    }
  });

  it("range muito maior que o limite (reproduz o bug real da issue #8: 1o ciclo lendo ~43 milhões de blocos): pagina em várias chamadas, todas dentro do limite, e concatena os logs na ordem", async () => {
    const adapter = new RecordingAdapter();
    const totalBlocks = MAX_LOG_RANGE_BLOCKS * 3n + 7n; // 3 chamadas cheias + 1 parcial
    const logs = await adapter.getConfirmedLogs({ address: TEST_ADDRESS, fromBlock: 1n, toBlock: totalBlocks });

    expect(adapter.calls).toHaveLength(4);
    for (const call of adapter.calls) {
      expect(call.toBlock - call.fromBlock + 1n).toBeLessThanOrEqual(MAX_LOG_RANGE_BLOCKS);
    }
    // cada chamada contígua com a anterior - nenhum bloco pulado, nenhum repetido
    for (let i = 1; i < adapter.calls.length; i++) {
      expect(adapter.calls[i]!.fromBlock).toBe(adapter.calls[i - 1]!.toBlock + 1n);
    }
    expect(adapter.calls[0]!.fromBlock).toBe(1n);
    expect(adapter.calls[adapter.calls.length - 1]!.toBlock).toBe(totalBlocks);
    expect(logs).toHaveLength(8); // 2 logs fake por chamada x 4 chamadas
  });

  it("toBlock < fromBlock: não chama o RPC nenhuma vez", async () => {
    const adapter = new RecordingAdapter();
    const logs = await adapter.getConfirmedLogs({ address: TEST_ADDRESS, fromBlock: 20n, toBlock: 10n });

    expect(adapter.calls).toHaveLength(0);
    expect(logs).toEqual([]);
  });
});
