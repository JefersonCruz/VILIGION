/**
 * Contrato de integração que QUALQUER rede precisa cumprir pra ser monitorada
 * pelo núcleo (monitor.ts), EVM ou não.
 *
 * Por que isto existe, concretamente: antes deste arquivo, `Monitor` recebia
 * no construtor a classe concreta `EvmAdapter`. Enquanto toda rede suportada
 * era EVM-compatível isso não incomodava, mas tornava impossível integrar uma
 * rede de família diferente (Solana, por exemplo) sem editar o núcleo - e o
 * núcleo é justamente a parte que um colaborador externo não deveria precisar
 * tocar pra adicionar uma rede. O contrato aqui é deliberadamente MÍNIMO: só
 * os três métodos que o Monitor de fato chama por ciclo (ver monitor.ts#tick),
 * mais os metadados e as capacidades declaradas.
 *
 * O que este contrato NÃO tenta fazer, de propósito:
 *
 * - Não impõe um método por funcionalidade imaginável. Consulta de eventos de
 *   protocolo (ex: TransferBlocked da Tempo) fica fora daqui, em
 *   `ChainExtension` - redes sem particularidade nenhuma não implementam nada
 *   a mais, e redes com particularidade não precisam encaixá-la numa
 *   assinatura genérica que não serve.
 * - Não assume que toda rede tem "bloco", "log", "token ERC-20" ou "moeda
 *   nativa". `getConfirmedBlockNumber` devolve um CURSOR monotônico opaco
 *   (bloco no EVM, slot em Solana) - o núcleo só compara e avança, nunca
 *   interpreta.
 * - Não assume equivalência semântica entre redes. O que uma rede não observa
 *   é declarado em `capabilities`, não simulado com um valor plausível.
 */

import type { Address } from "viem";

/**
 * Família técnica da rede. Existe pra um colaborador (e o processo de revisão)
 * saber de cara se um adaptador PODE reaproveitar o núcleo EVM ou precisa de
 * implementação própria - ver docs/ADAPTER_SPEC.md. Não é uma lista fechada
 * por design: uma família nova entra aqui junto com o primeiro adaptador dela.
 */
export type ChainFamily = "evm" | "svm" | "other";

/**
 * Snapshot de saldo, na menor unidade do ativo monitorado.
 *
 * `blockNumber` é o ponto da cadeia em que a leitura vale, no cursor opaco da
 * própria rede (número de bloco no EVM, slot em Solana). `observedAt` é a
 * hora LOCAL da leitura, não um timestamp vindo da rede: a janela de detecção
 * (balance-window.ts) mede tempo de parede entre duas observações nossas, e
 * um timestamp de bloco pode estar atrasado, adiantado ou ser controlado por
 * quem produz o bloco - nenhum desses é base confiável pra decidir alerta.
 */
export interface BalanceSnapshot {
  address: Address;
  /** saldo bruto, na menor unidade do ativo monitorado */
  raw: bigint;
  /** cursor da rede em que esta leitura vale (bloco no EVM, slot em Solana) */
  blockNumber: bigint;
  /** quando ESTA leitura foi feita, no relógio local - ver nota acima */
  observedAt: Date;
}

/**
 * O que um adaptador declara que consegue (e não consegue) observar.
 *
 * A regra é: declarar `false` é uma resposta legítima e documentada, não uma
 * falha. O caminho errado - e que este campo existe pra evitar - é um
 * adaptador devolver `0n` de um saldo que na verdade não sabe ler, porque aí
 * o núcleo trata "não observei" como "não houve movimento" e o usuário fica
 * sem proteção acreditando que está protegido. Ver docs/ADAPTER_SPEC.md →
 * "Declarar capacidade ausente".
 */
export interface ChainCapabilities {
  /**
   * Lê saldo de um token/ativo emitido (`balanceOf` ou equivalente). Quando
   * true, `requiresTokenAddress` diz se o endereço do token é obrigatório.
   */
  readonly tokenBalance: boolean;
  /**
   * Lê saldo da moeda NATIVA da rede. `false` na Tempo, que não tem gas token
   * nativo: lá `eth_getBalance` responde, mas o número não tem relação com o
   * saldo TIP-20 da tesouraria (confirmado contra a testnet Moderato - ver
   * scripts/verify-testnet.ts). Uma capacidade que responde com um valor
   * irrelevante é pior que uma capacidade ausente, por isso é declarada
   * ausente.
   */
  readonly nativeBalance: boolean;
  /**
   * Consegue enumerar eventos/logs históricos num intervalo de cursor. Base
   * pra qualquer `ChainExtension` e pra classificação de taxa.
   */
  readonly historicalEvents: boolean;
  /**
   * A taxa de transação sai do MESMO ativo monitorado. `true` na Tempo (sem
   * gas token nativo), `false` em EVM com moeda nativa de verdade. Quando
   * true, o adaptador DEVE implementar `getFeeAdjustment` de verdade, senão
   * pagamento de taxa legítimo vira falso positivo de queda de saldo.
   */
  readonly feePaidInMonitoredAsset: boolean;
  /**
   * A rede pode reorganizar (reorg) e por isso exige profundidade de
   * confirmação. `false` só pra redes com finalidade determinística onde
   * esperar confirmação não faz sentido.
   */
  readonly reorgPossible: boolean;
  /** `tokenBalance` só funciona com um endereço de token configurado. */
  readonly requiresTokenAddress: boolean;
}

/** Identidade da rede, pro log, pro painel e pra matriz de compatibilidade. */
export interface AdapterMetadata {
  /** chave estável usada no banco (`monitored_accounts.chain_key`) e no registro */
  readonly chainKey: string;
  readonly displayName: string;
  readonly family: ChainFamily;
  /**
   * Chain ID numérico EVM. Ausente de propósito pra famílias que não têm esse
   * conceito - não inventar um número só pra preencher o campo.
   */
  readonly chainId?: number;
}

/**
 * Erro que um adaptador lança quando o chamador pede algo que ele declarou
 * NÃO suportar. Tipo próprio (em vez de `Error` genérico) pra que um chamador
 * consiga distinguir "esta rede não faz isso" de "a rede está fora do ar" -
 * a primeira nunca melhora com retry, a segunda sim.
 */
export class UnsupportedCapabilityError extends Error {
  constructor(
    readonly chainKey: string,
    readonly capability: keyof ChainCapabilities,
    details?: string,
  ) {
    super(
      `A rede "${chainKey}" não suporta "${capability}"${details ? `: ${details}` : ""}. ` +
        "Capacidades ausentes são declaradas, não simuladas - ver docs/ADAPTER_SPEC.md.",
    );
    this.name = "UnsupportedCapabilityError";
  }
}

/**
 * O contrato que o `Monitor` consome. Qualquer coisa que cumpra isto pode ser
 * monitorada sem alterar uma linha do núcleo - é exatamente essa a propriedade
 * que a arquitetura precisa ter pra aceitar contribuição externa, e o que
 * `adapter-conformance.ts` verifica em teste.
 */
export interface MonitoredChainAdapter {
  readonly metadata: AdapterMetadata;
  readonly capabilities: ChainCapabilities;

  /**
   * Maior intervalo de cursor que esta rede aceita numa consulta de histórico.
   * Vive no adaptador, não no núcleo, porque é um limite do provedor/protocolo
   * de cada rede (no EVM o provedor da Tempo rejeita acima de 100.000 blocos;
   * em Solana a unidade não é nem "bloco"). O Monitor usa isto pra decidir o
   * tamanho do gap que tenta recuperar - ver monitor.ts#tick.
   */
  readonly maxHistoryWindow: bigint;

  /** Saldo do ativo monitorado. Deve lançar em vez de devolver 0n quando não conseguir ler. */
  getBalance(address: Address): Promise<BalanceSnapshot>;

  /** Cursor mais recente já confirmado o suficiente pra confiar (ver reorgPossible/minConfirmations). */
  getConfirmedBlockNumber(): Promise<bigint>;

  /**
   * Quanto do delta de saldo entre dois cursores é só dedução de taxa, não
   * saída real de valor. `0n` é a resposta CORRETA (não um placeholder)
   * quando `capabilities.feePaidInMonitoredAsset` é false.
   */
  getFeeAdjustment(fromBlock: bigint, toBlock: bigint, address: Address): Promise<bigint>;

  /**
   * Libera recursos (socket, pool, subscription). Opcional porque adaptador
   * sobre HTTP puro - o caso de hoje - não tem nada pra fechar; um adaptador
   * com websocket tem, e sem este ponto no contrato o processo não encerra.
   */
  close?(): Promise<void>;
}
