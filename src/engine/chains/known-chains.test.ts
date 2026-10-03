import { describe, expect, it } from "vitest";
import { getKnownChain, KNOWN_CHAINS, resolveRpcUrl } from "./known-chains.js";

describe("known-chains", () => {
  it("lista Tempo e as chains EVM-compatíveis de baixo custo marginal (Base, Arbitrum, Ethereum L1)", () => {
    expect(Object.keys(KNOWN_CHAINS)).toEqual(
      expect.arrayContaining(["tempo", "base", "arbitrum", "ethereum"]),
    );
  });

  it("só a Tempo tem extensão de protocolo (TransferBlocked não existe nas outras)", () => {
    expect(getKnownChain("tempo").hasTempoStyleExtensions).toBe(true);
    expect(getKnownChain("base").hasTempoStyleExtensions).toBe(false);
    expect(getKnownChain("arbitrum").hasTempoStyleExtensions).toBe(false);
    expect(getKnownChain("ethereum").hasTempoStyleExtensions).toBe(false);
  });

  it("lança erro claro para chain desconhecida", () => {
    expect(() => getKnownChain("chain-que-nao-existe")).toThrow(/desconhecida/);
  });

  it("resolveRpcUrl prioriza override de env sobre o RPC público default", () => {
    const resolved = resolveRpcUrl("base", "https://meu-rpc-dedicado.example.com");
    expect(resolved).toBe("https://meu-rpc-dedicado.example.com");
  });

  it("resolveRpcUrl cai pro RPC público default quando não há override", () => {
    const resolved = resolveRpcUrl("base", undefined);
    expect(resolved).toBe("https://mainnet.base.org");
  });

  it("resolveRpcUrl lança erro quando a chain não tem RPC público nem override (caso da Tempo)", () => {
    expect(() => resolveRpcUrl("tempo", undefined)).toThrow(/Nenhum RPC configurado/);
  });
});
