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
import type { AddressCheck, ChainFamily, MonitoredChainAdapter } from "./chain-adapter.js";
import { checkEvmAddress, EvmAdapter } from "./evm-adapter.js";
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
  /**
   * Profundidade de confirmação. OPCIONAL de propósito: quando ausente, vale
   * a `defaultMinConfirmations` declarada pela própria rede.
   *
   * Antes era obrigatória, e `index.ts` escrevia `minConfirmations: 3` na mão
   * em quatro pontos. Isso punha no CHAMADOR uma decisão que é propriedade da
   * REDE - quantos blocos esperar antes de confiar depende do modelo de
   * finalidade e do comportamento de reorg dela, não de quem está montando o
   * adaptador. Quatro cópias do mesmo número também divergem na primeira vez
   * que uma delas muda.
   *
   * Continua aceitando override porque um operador pode ter motivo
   * (um provedor de RPC atrasado, um ambiente de teste) - mas agora é uma
   * exceção explícita, não o caminho normal.
   */
  minConfirmations?: number;
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
   * Quantos blocos/slots esperar antes de tratar um evento como real nesta
   * rede. Vive aqui, e não no chamador, porque é propriedade do modelo de
   * finalidade da rede.
   */
  readonly defaultMinConfirmations: number;
  /**
   * Por que esse número, em uma linha.
   *
   * Campo obrigatório de propósito: um número de confirmação sem
   * justificativa é exatamente o tipo de constante que ninguém revisa e
   * todo mundo copia. Quando a justificativa for "herdado, não analisado
   * para esta rede", isso tem que estar escrito - e `confirmationJustified`
   * abaixo torna o estado verificável em teste, em vez de depender de
   * alguém ler a prosa.
   */
  readonly confirmationRationale: string;
  /**
   * `false` quando a profundidade é um default herdado que ninguém analisou
   * contra o comportamento real de reorg desta rede. É uma lacuna declarada,
   * igual a `supportStatus: "experimental"` - e o boot avisa quando sobe um
   * monitor nessa situação.
   */
  readonly confirmationJustified: boolean;
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
  /**
   * Valida e normaliza um endereco desta rede, SEM construir o adaptador.
   *
   * Existe separado de `build` porque o formulario de /accounts precisa
   * validar antes de gravar, e construir o adaptador ali exigiria URL de RPC
   * configurada so pra conferir um campo de texto - um RPC nao configurado
   * passaria a impedir o cadastro da conta.
   *
   * DEVE ser literalmente a mesma funcao que o adaptador usa no
   * `checkAddress` dele, nao uma segunda copia da regra. Duas copias viram
   * duas regras diferentes com o tempo, e a divergencia aparece como "o
   * formulario aceitou, o monitor recusa". `chain-registry.test.ts` verifica
   * essa igualdade pra toda rede registrada.
   */
  checkAddress(raw: string): AddressCheck;
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
  const integration = CHAIN_INTEGRATIONS[chainKey];
  return {
    adapter: new EvmAdapter({
      rpcUrl: context.rpcUrl,
      chainId: chain.chainId,
      minConfirmations: context.minConfirmations ?? integration?.defaultMinConfirmations ?? INHERITED_MIN_CONFIRMATIONS,
      tokenAddress: context.tokenAddress,
      chainKey: chain.id,
      displayName: chain.name,
    }),
  };
}

/**
 * Profundidade de confirmação que o projeto vinha usando pra TODA rede, antes
 * de este campo existir: `index.ts` escrevia `3` na mão em quatro pontos.
 *
 * Preservada como está, de propósito, e NÃO "corrigida" pra um número maior.
 * Escolher a profundidade de cada rede é decisão de produto antes de ser
 * técnica: confirmação mais funda reduz alerta falso por reorg, mas ATRASA o
 * aviso - e num produto cuja função é avisar o dono de que a tesouraria está
 * sendo drenada, latência de alerta é um custo real, não um detalhe. Trocar
 * `3` por um número que eu não consigo justificar com o comportamento medido
 * de cada rede seria inventar precisão.
 *
 * O que esta mudança faz é parar de esconder a decisão: o número deixa de
 * estar espalhado em quatro chamadas e passa a ser um valor declarado por
 * rede, com justificativa escrita e um sinalizador dizendo se alguém de fato
 * a analisou.
 */
export const INHERITED_MIN_CONFIRMATIONS = 3;

function genericEvmIntegration(chainKey: string): ChainIntegration {
  const chain = getKnownChain(chainKey);
  return {
    chainKey: chain.id,
    displayName: chain.name,
    family: "evm",
    supportStatus: "experimental",
    defaultMinConfirmations: INHERITED_MIN_CONFIRMATIONS,
    confirmationJustified: false,
    confirmationRationale:
      "Herdada do default do projeto, NÃO analisada para esta rede. Ninguém verificou o " +
      "comportamento de reorg dela nem decidiu o custo aceitável de latência de alerta. " +
      "Em L2 (Base, Arbitrum) o problema é maior do que parece: um bloco já 'confirmado' na " +
      "L2 ainda pode ser revertido se o lote correspondente na L1 reorganizar, então contar " +
      "blocos da L2 não mede o risco real. Ver docs/CHAIN-SUPPORT-MATRIX.md.",
    maintainer: null,
    checkAddress: checkEvmAddress,
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
    defaultMinConfirmations: INHERITED_MIN_CONFIRMATIONS,
    confirmationJustified: false,
    confirmationRationale:
      "É a profundidade com que a Tempo foi de fato exercitada contra a testnet Moderato " +
      "(scripts/verify-testnet.ts), então não é um número solto - mas também não é um número " +
      "derivado do modelo de finalidade da rede, porque essa análise não foi feita. " +
      "Declarada como não justificada por honestidade: funcionar na testnet não é o mesmo que " +
      "ser a profundidade correta para uma tesouraria em mainnet.",
    maintainer: "@JefersonCruz",
    validationEvidence:
      "scripts/verify-testnet.ts roda contra a testnet Moderato real: confirma RPC e chain ID, " +
      "compara RECEIVE_POLICY_GUARD_ADDRESS com Addresses.receivePolicyGuard do viem/tempo, e " +
      "exercita a decodificação do TransferBlocked. Classificação de taxa (getFeeAdjustment) e " +
      "decodificação do witness têm testes determinísticos em tempo.adapter.test.ts.",
    // Tempo e EVM-compativel, entao o endereco tem exatamente o formato de EVM.
    checkAddress: checkEvmAddress,
    build: (context) => {
      const chain = getKnownChain("tempo");
      const adapter = new TempoAdapter({
        rpcUrl: context.rpcUrl,
        chainId: chain.chainId,
        minConfirmations:
          context.minConfirmations ?? CHAIN_INTEGRATIONS.tempo?.defaultMinConfirmations ?? INHERITED_MIN_CONFIRMATIONS,
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
  /** Ausente = usa a `defaultMinConfirmations` declarada pela rede. */
  minConfirmations?: number;
  rpcUrlOverride?: string;
}): BuiltChainIntegration {
  const integration = getChainIntegration(params.chainKey);
  return integration.build({
    rpcUrl: resolveRpcUrl(params.chainKey, params.rpcUrlOverride),
    tokenAddress: params.tokenAddress,
    minConfirmations: params.minConfirmations,
  });
}
