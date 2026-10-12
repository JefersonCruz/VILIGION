/**
 * Registro de integrações de rede: dado UMA chave de rede, devolve o
 * adaptador montado e a extensão de protocolo dela, se houver.
 *
 * Existe por dois problemas concretos encontrados na auditoria:
 *
 * 1. `index.ts` decidia a rede com `if (account.chainKey === "tempo")`.
 *    Adicionar uma rede exigia editar o ponto de entrada da aplicação - ou
 *    seja, o núcleo - o que torna uma contribuição externa de rede uma
 *    mudança no caminho crítico de todo mundo, e não um módulo isolado.
 * 2. `known-chains.ts` tinha o campo `hasTempoStyleExtensions`, que NUNCA era
 *    lido em produção: só aparecia em asserção de teste. Era dado morto que
 *    dava a impressão de que a escolha de extensão era configurável, quando
 *    de fato estava no `===` acima. Uma rede "registrada" assim não é uma
 *    rede suportada. Agora quem decide é a função `build` desta tabela, que é
 *    o que a aplicação de fato executa.
 *
 * `supportStatus` é o outro ponto honesto deste arquivo: estar registrado
 * aqui NÃO significa suporte de produção. Ver docs/CHAIN-SUPPORT-MATRIX.md.
 */

import type { Address } from "viem";
import type { ChainExtension } from "../chain-extension.js";
import type { ChainFamily, MonitoredChainAdapter } from "./chain-adapter.js";
import { EvmAdapter } from "./evm-adapter.js";
import { RECEIVE_POLICY_GUARD_ADDRESS, TempoAdapter } from "./tempo.adapter.js";
import { TempoBlockedTransferExtension } from "./tempo-extension.js";
import { getKnownChain, resolveRpcUrl } from "./known-chains.js";

/**
 * Maturidade real de uma integração - evidência, não intenção.
 *
 * - `experimental`: o código existe e compila. Nunca foi exercitado contra a
 *   rede real. É o default de toda rede nova, inclusive das que o VILIGION já
 *   lista: Base, Arbitrum e Ethereum L1 entram aqui porque o único smoke test
 *   contra rede real que o projeto tem (`scripts/verify-testnet.ts`) só toca a
 *   Tempo.
 * - `validating`: já rodou contra a rede real (testnet ou mainnet), com
 *   resultado registrado, e tem testes determinísticos cobrindo os modos de
 *   falha. Ainda sem uso prolongado.
 * - `stable`: além do acima, rodou em produção por tempo suficiente pra que
 *   os modos de falha conhecidos tenham aparecido e sido tratados, e tem
 *   mantenedor declarado.
 *
 * Nenhuma rede está `stable` hoje, e isso é uma afirmação sobre evidência
 * disponível, não modéstia - ver docs/CHAIN-SUPPORT-MATRIX.md pro que falta
 * em cada uma.
 */
export type ChainSupportStatus = "experimental" | "validating" | "stable";

/** O que o chamador precisa fornecer pra montar um adaptador, qualquer que seja a rede. */
export interface AdapterBuildContext {
  /** RPC já resolvido (override de env ou default público) - ver resolveRpcUrl. */
  rpcUrl: string;
  /**
   * Endereço do token/ativo monitorado. Opcional no contexto genérico porque
   * há redes que leem a moeda nativa; obrigatório nas que declaram
   * `requiresTokenAddress` (a Tempo rejeita no construtor se faltar).
   */
  tokenAddress?: Address;
  minConfirmations: number;
}

/** Adaptador + extensão opcional, prontos pra entregar ao Monitor. */
export interface BuiltChainIntegration {
  adapter: MonitoredChainAdapter;
  /** Ausente quando a rede não tem particularidade de protocolo - a maioria. */
  extension?: ChainExtension;
}

export interface ChainIntegration {
  readonly chainKey: string;
  readonly displayName: string;
  readonly family: ChainFamily;
  readonly supportStatus: ChainSupportStatus;
  /**
   * GitHub handle de quem se responsabiliza por esta integração, ou `null`
   * quando ninguém se declarou.
   *
   * `null` é informação, não lacuna a preencher: uma rede sem mantenedor é
   * uma rede que ninguém verifica quando o protocolo dela muda, e o painel/a
   * matriz de compatibilidade precisam poder dizer isso. Não preencher este
   * campo com um nome que não concordou com a responsabilidade.
   */
  readonly maintainer: string | null;
  /**
   * Resumo do que FOI de fato verificado contra a rede real, em uma linha.
   * Texto livre de propósito - a alternativa (um enum de capacidades
   * "testadas") convidaria a marcar caixinhas sem evidência.
   */
  readonly validationEvidence: string;
  build(context: AdapterBuildContext): BuiltChainIntegration;
}

/**
 * Monta um adaptador EVM genérico, sem extensão de protocolo.
 *
 * Compartilhado por Base/Arbitrum/Ethereum porque nessas redes é literalmente
 * a mesma coisa trocando o RPC - e dizer isso em uma função só é melhor que
 * repetir três vezes e deixar as três divergirem com o tempo.
 */
function buildGenericEvm(chainKey: string, context: AdapterBuildContext): BuiltChainIntegration {
  const chain = getKnownChain(chainKey);
  return {
    adapter: new EvmAdapter({
      rpcUrl: context.rpcUrl,
      chainId: chain.chainId,
      minConfirmations: context.minConfirmations,
      tokenAddress: context.tokenAddress,
      chainKey: chain.id,
      displayName: chain.name,
    }),
  };
}

function genericEvmIntegration(chainKey: string): ChainIntegration {
  const chain = getKnownChain(chainKey);
  return {
    chainKey: chain.id,
    displayName: chain.name,
    family: "evm",
    supportStatus: "experimental",
    maintainer: null,
    validationEvidence:
      "Nenhuma verificação contra a rede real. O adaptador EVM genérico tem testes " +
      "determinísticos (paginação, conformidade), mas nenhum smoke test desta rede " +
      "específica - ver docs/CHAIN-SUPPORT-MATRIX.md.",
    build: (context) => buildGenericEvm(chain.id, context),
  };
}

export const CHAIN_INTEGRATIONS: Record<string, ChainIntegration> = {
  tempo: {
    chainKey: "tempo",
    displayName: "Tempo",
    family: "evm",
    /**
     * `validating`, não `stable`: tem smoke test contra a testnet Moderato
     * real (scripts/verify-testnet.ts confirma RPC, chain ID, endereço do
     * Guard contra viem/tempo e decodificação do witness) e testes
     * determinísticos dos modos de falha. O que falta pra `stable` é tempo de
     * operação com tesouraria real - e isso não se declara, se acumula.
     */
    supportStatus: "validating",
    maintainer: "@JefersonCruz",
    validationEvidence:
      "scripts/verify-testnet.ts roda contra a testnet Moderato real: confirma RPC e chain ID, " +
      "compara RECEIVE_POLICY_GUARD_ADDRESS com Addresses.receivePolicyGuard do viem/tempo, e " +
      "exercita a decodificação do TransferBlocked. Classificação de taxa (getFeeAdjustment) e " +
      "decodificação do witness têm testes determinísticos em tempo.adapter.test.ts.",
    build: (context) => {
      const chain = getKnownChain("tempo");
      const adapter = new TempoAdapter({
        rpcUrl: context.rpcUrl,
        chainId: chain.chainId,
        minConfirmations: context.minConfirmations,
        receivePolicyGuardAddress: RECEIVE_POLICY_GUARD_ADDRESS,
        tokenAddress: context.tokenAddress,
        chainKey: chain.id,
        displayName: chain.name,
      });
      return { adapter, extension: new TempoBlockedTransferExtension(adapter) };
    },
  },
  base: genericEvmIntegration("base"),
  arbitrum: genericEvmIntegration("arbitrum"),
  ethereum: genericEvmIntegration("ethereum"),
};

export function getChainIntegration(chainKey: string): ChainIntegration {
  const integration = CHAIN_INTEGRATIONS[chainKey];
  if (!integration) {
    throw new Error(
      `Nenhuma integração registrada para a rede "${chainKey}". ` +
        `Registradas: ${Object.keys(CHAIN_INTEGRATIONS).join(", ")}. ` +
        "Pra adicionar uma, ver docs/DEVELOPING_ADAPTERS.md.",
    );
  }
  return integration;
}

/**
 * Monta a integração de uma rede a partir da chave e do token monitorado.
 *
 * É o único ponto que a aplicação precisa chamar pra passar de "chave de rede
 * que veio do banco" a "adaptador + extensão prontos", e a razão pela qual
 * `index.ts` não precisa mais conhecer rede nenhuma por nome.
 */
export function buildChainIntegration(params: {
  chainKey: string;
  tokenAddress?: Address;
  minConfirmations: number;
  rpcUrlOverride?: string;
}): BuiltChainIntegration {
  const integration = getChainIntegration(params.chainKey);
  return integration.build({
    rpcUrl: resolveRpcUrl(params.chainKey, params.rpcUrlOverride),
    tokenAddress: params.tokenAddress,
    minConfirmations: params.minConfirmations,
  });
}
