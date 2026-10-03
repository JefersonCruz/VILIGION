/**
 * Registro de chains EVM-compatíveis que o VILIGION pode monitorar com o
 * MESMO motor genérico (evm-adapter.ts), trocando só o RPC — a base técnica
 * real da estratégia multi-track do pitch (ver ARCHITECTURE.md e o PDF/deck
 * de apresentação).
 *
 * `hasTempoStyleExtensions: false` para todas exceto Tempo, de propósito:
 * o evento TransferBlocked/ReceivePolicyGuard é um mecanismo específico da
 * Tempo (TIP-403), não existe em Base/Arbitrum/Ethereum - ver o achado da
 * revisão de segurança em ARCHITECTURE.md sobre por que o motor não é
 * "100% genérico", e sim núcleo + adaptador por chain.
 *
 * RPCs públicos abaixo são defaults razoáveis para desenvolvimento; em
 * produção, prefira um provedor dedicado (Alchemy/Infura/etc) via env.
 */

export interface KnownChainConfig {
  id: string;
  name: string;
  chainId: number;
  defaultPublicRpcUrl: string;
  /** Track de prêmio correspondente no regulamento do Crypto World's Fair */
  hackathonTrack: string;
  hasTempoStyleExtensions: boolean;
}

export const KNOWN_CHAINS: Record<string, KnownChainConfig> = {
  tempo: {
    id: "tempo",
    name: "Tempo",
    // Mainnet. Confirmado contra o RPC real em 2026-10-03 (ver scripts/verify-testnet.ts)
    // e batendo com a definição oficial em viem/chains (tempo/tempoMainnet).
    // Testnet Moderato, pra desenvolvimento: chainId 42431, RPC https://rpc.moderato.tempo.xyz
    chainId: 4217,
    defaultPublicRpcUrl: "https://rpc.tempo.xyz",
    hackathonTrack: "Tempo ($100.000 / 10 vagas)",
    hasTempoStyleExtensions: true,
  },
  base: {
    id: "base",
    name: "Base",
    chainId: 8453,
    defaultPublicRpcUrl: "https://mainnet.base.org",
    hackathonTrack: "Base ($25.000 / 5 vagas)",
    hasTempoStyleExtensions: false,
  },
  arbitrum: {
    id: "arbitrum",
    name: "Arbitrum One",
    chainId: 42161,
    defaultPublicRpcUrl: "https://arb1.arbitrum.io/rpc",
    hackathonTrack: "Arbitrum ($25.000 / 5 vagas)",
    hasTempoStyleExtensions: false,
  },
  ethereum: {
    id: "ethereum",
    name: "Ethereum L1",
    chainId: 1,
    defaultPublicRpcUrl: "https://ethereum-rpc.publicnode.com",
    hackathonTrack: "Ethereum L1 ($25.000 / 5 vagas)",
    hasTempoStyleExtensions: false,
  },
};

export function getKnownChain(id: string): KnownChainConfig {
  const chain = KNOWN_CHAINS[id];
  if (!chain) {
    throw new Error(`Chain desconhecida: "${id}". Chains registradas: ${Object.keys(KNOWN_CHAINS).join(", ")}`);
  }
  return chain;
}

export function resolveRpcUrl(id: string, envOverride: string | undefined): string {
  const url = envOverride || getKnownChain(id).defaultPublicRpcUrl;
  if (!url) {
    throw new Error(`Nenhum RPC configurado para "${id}" - defina via variável de ambiente.`);
  }
  return url;
}
