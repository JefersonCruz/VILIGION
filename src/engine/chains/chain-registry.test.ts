import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  buildChainIntegration,
  CHAIN_INTEGRATIONS,
  getChainIntegration,
} from "./chain-registry.js";
import { KNOWN_CHAINS } from "./known-chains.js";
import { TempoAdapter } from "./tempo.adapter.js";
import { EvmAdapter } from "./evm-adapter.js";
import { UnsupportedCapabilityError } from "./chain-adapter.js";

const TOKEN = "0x0000000000000000000000000000000000000001" as Address;

describe("registro de integrações de rede", () => {
  it("toda rede listada em known-chains tem uma integração registrada", () => {
    // Guarda contra o problema que o registro existe pra resolver: uma rede
    // aparecer na lista (e no painel, e no pitch) sem nada que a monitore.
    // Nome registrado não é rede suportada.
    for (const chainKey of Object.keys(KNOWN_CHAINS)) {
      expect(() => getChainIntegration(chainKey)).not.toThrow();
    }
  });

  it("o flag hasTempoStyleExtensions de known-chains concorda com quem de fato monta extensão", () => {
    /**
     * Aquele flag era dado morto: só aparecia em asserção de teste, nunca no
     * caminho de produção (quem decidia era um `=== "tempo"` no index.ts).
     * Este teste amarra o dado à realidade - se alguém marcar uma rede como
     * tendo extensão sem registrar uma, ou o contrário, falha aqui em vez de
     * passar a informação errada pro resto do projeto.
     */
    for (const [chainKey, chain] of Object.entries(KNOWN_CHAINS)) {
      const built = buildChainIntegration({ chainKey, tokenAddress: TOKEN, minConfirmations: 3 });
      expect(built.extension !== undefined).toBe(chain.hasTempoStyleExtensions);
    }
  });

  it("rede desconhecida: erro que diz quais existem e onde aprender a adicionar uma", () => {
    expect(() => getChainIntegration("rede-que-nao-existe")).toThrow(/Nenhuma integração registrada/);
    expect(() => getChainIntegration("rede-que-nao-existe")).toThrow(/DEVELOPING_ADAPTERS/);
  });

  describe("Tempo", () => {
    it("monta TempoAdapter com a extensão de protocolo", () => {
      const built = buildChainIntegration({ chainKey: "tempo", tokenAddress: TOKEN, minConfirmations: 3 });

      expect(built.adapter).toBeInstanceOf(TempoAdapter);
      expect(built.extension).toBeDefined();
    });

    it("declara as capacidades reais da rede: sem saldo nativo, taxa no ativo monitorado, token obrigatório", () => {
      const { adapter } = buildChainIntegration({ chainKey: "tempo", tokenAddress: TOKEN, minConfirmations: 3 });

      expect(adapter.capabilities.nativeBalance).toBe(false);
      expect(adapter.capabilities.feePaidInMonitoredAsset).toBe(true);
      expect(adapter.capabilities.requiresTokenAddress).toBe(true);
    });

    it("recusa configuração sem endereço de token em vez de ler um saldo que não é o da tesouraria", () => {
      // O pior modo de falha de um produto de vigilância é o monitor cego que
      // parece saudável. Ver a nota no construtor de TempoAdapter.
      expect(() => buildChainIntegration({ chainKey: "tempo", minConfirmations: 3 })).toThrow(
        UnsupportedCapabilityError,
      );
    });

    it("metadata carrega a chave estável da rede, não um identificador derivado do chainId", () => {
      const { adapter } = buildChainIntegration({ chainKey: "tempo", tokenAddress: TOKEN, minConfirmations: 3 });

      expect(adapter.metadata.chainKey).toBe("tempo");
      expect(adapter.metadata.displayName).toBe("Tempo");
      expect(adapter.metadata.family).toBe("evm");
    });
  });

  describe("redes EVM genéricas", () => {
    it("montam o núcleo genérico, sem extensão - TransferBlocked não existe nelas", () => {
      for (const chainKey of ["base", "arbitrum", "ethereum"]) {
        const built = buildChainIntegration({ chainKey, tokenAddress: TOKEN, minConfirmations: 3 });

        expect(built.adapter).toBeInstanceOf(EvmAdapter);
        expect(built.adapter).not.toBeInstanceOf(TempoAdapter);
        expect(built.extension).toBeUndefined();
      }
    });

    it("aceitam configuração sem endereço de token - têm moeda nativa de verdade", () => {
      expect(() => buildChainIntegration({ chainKey: "base", minConfirmations: 3 })).not.toThrow();
    });

    it("pegam o chainId de known-chains, sem número duplicado no registro", () => {
      const { adapter } = buildChainIntegration({ chainKey: "base", minConfirmations: 3 });
      expect(adapter.metadata.chainId).toBe(KNOWN_CHAINS.base?.chainId);
    });
  });

  describe("honestidade sobre maturidade", () => {
    it("nenhuma rede está marcada como estável - nenhuma tem evidência pra isso hoje", () => {
      const stable = Object.values(CHAIN_INTEGRATIONS).filter((i) => i.supportStatus === "stable");
      expect(stable).toEqual([]);
    });

    it("Base, Arbitrum e Ethereum são experimentais: o único smoke test contra rede real só toca a Tempo", () => {
      for (const chainKey of ["base", "arbitrum", "ethereum"]) {
        expect(getChainIntegration(chainKey).supportStatus).toBe("experimental");
      }
    });

    it("toda integração explica por escrito o que foi de fato verificado", () => {
      for (const integration of Object.values(CHAIN_INTEGRATIONS)) {
        expect(integration.validationEvidence.length).toBeGreaterThan(40);
      }
    });

    it("rede sem mantenedor declarado tem maintainer null - não um nome que ninguém aceitou", () => {
      expect(getChainIntegration("base").maintainer).toBeNull();
      expect(getChainIntegration("tempo").maintainer).toBe("@JefersonCruz");
    });

    it("rede com mantenedor é a única que passou de experimental - responsabilidade e maturidade andam juntas", () => {
      for (const integration of Object.values(CHAIN_INTEGRATIONS)) {
        if (integration.supportStatus === "experimental") continue;
        expect(integration.maintainer).not.toBeNull();
      }
    });
  });

  describe("resolução de RPC", () => {
    it("override explícito vence o RPC público default", () => {
      const built = buildChainIntegration({
        chainKey: "base",
        minConfirmations: 3,
        rpcUrlOverride: "https://meu-rpc-dedicado.example.com",
      });
      // Sem expor o rpcUrl no contrato público do adaptador, o que dá pra
      // afirmar aqui é que a montagem com override funciona - a prioridade em
      // si é testada em known-chains.test.ts, onde resolveRpcUrl mora.
      expect(built.adapter.metadata.chainKey).toBe("base");
    });
  });
});
