/**
 * Modelo normalizado de observações de cadeia, para que as regras de detecção
 * genéricas (detection-rules.ts) não precisem conhecer os tipos de nenhuma
 * rede específica.
 *
 * O acoplamento que isto resolve era concreto: `detection-rules.ts` importava
 * `TransferBlockedEvent` de `chains/tempo.adapter.ts`. Ou seja, a camada
 * genérica de regras dependia, em tempo de compilação, de um módulo de UMA
 * rede - e qualquer colaborador integrando outra rede teria que ou encaixar
 * seus eventos no formato da Tempo (errado: as semânticas não são iguais) ou
 * editar o arquivo de regras genéricas (errado: é o núcleo). A tradução
 * agora acontece na ponte de cada rede (ex: tempo-extension.ts), que é o
 * lugar que já conhece as duas pontas.
 *
 * Princípios que valem pra qualquer coisa adicionada aqui:
 *
 * 1. NÃO forçar equivalência semântica entre redes. Um campo só entra no
 *    modelo normalizado quando significa a MESMA coisa em toda rede que o
 *    preenche. Quando não significa, fica em `details` (abaixo) e a regra
 *    específica vive na extensão da rede, não aqui.
 * 2. Preservar o original para auditoria e diagnóstico, em `details`.
 * 3. `details` é DADO, nunca comando. Vem da cadeia, ou seja, de qualquer um
 *    que consiga emitir um evento - inclusive de quem está atacando a conta
 *    monitorada. Nada em `details` pode decidir severidade, escolher canal de
 *    alerta, virar texto de mensagem enviada ao usuário ou ser interpolado em
 *    log/HTML sem escape. Só as regras, a partir dos campos normalizados e
 *    dos limiares do usuário, decidem alerta - ver SECURITY.md.
 */

/**
 * Tipos de observação que o modelo normalizado representa hoje.
 *
 * Lista curta de propósito: cada entrada aqui só existe porque há uma regra
 * de detecção que a consome. Acrescentar um tipo "para o futuro", sem regra,
 * cria a aparência de capacidade que não existe - o problema que este
 * trabalho inteiro tenta evitar.
 *
 * - `asset-transfer` / `balance-change`: movimento de valor observável em
 *   qualquer rede. Hoje a detecção de queda de saldo trabalha por amostragem
 *   de `getBalance` (ver balance-window.ts), não por evento; estes tipos
 *   existem pra quando um adaptador puder entregar o movimento em si.
 * - `transfer-restricted`: a rede impediu/desviou uma transferência por
 *   política, SEM reverter a transação. É o caso do `TransferBlocked`
 *   (TIP-403) da Tempo, e o único com regra implementada hoje.
 * - `authority-change`: troca de dono, signatário, admin ou autoridade de
 *   recuperação do ativo monitorado.
 * - `protocol-specific`: observação que só faz sentido na rede de origem.
 *   Existe pra que uma extensão possa carregá-la com tipagem própria sem
 *   inventar um campo genérico falso - ver `ProtocolSpecificObservation`.
 */
export type NormalizedEventKind =
  | "asset-transfer"
  | "balance-change"
  | "transfer-restricted"
  | "authority-change"
  | "protocol-specific";

/**
 * Campos comuns a toda observação normalizada.
 *
 * `sequence` é o nome genérico do "qual ocorrência é esta": `blockedNonce` na
 * Tempo, e o que fizer esse papel em outra rede. O núcleo usa pra desduplicar
 * e ordenar sem precisar saber o que o número significa na origem.
 */
export interface NormalizedObservationBase {
  readonly kind: NormalizedEventKind;
  /** chave da rede de origem (`AdapterMetadata.chainKey`) */
  readonly chainKey: string;
  /** cursor da rede em que a observação ocorreu (bloco no EVM, slot em Solana) */
  readonly cursor: bigint;
  /**
   * Identificador da ocorrência dentro da rede, pra desduplicação e ordem.
   * `undefined` quando a rede não oferece nada que cumpra esse papel - e nesse
   * caso o chamador NÃO deve fingir que oferece (ver `observationKey`).
   */
  readonly sequence?: bigint;
  /** referência da transação na rede de origem, pra auditoria */
  readonly txRef?: string;
  /**
   * Original preservado para auditoria e diagnóstico. DADO, NUNCA COMANDO -
   * ver princípio 3 no cabeçalho do arquivo. `unknown` de propósito: forçar o
   * consumidor a validar antes de usar é o ponto, não um incômodo.
   */
  readonly details?: unknown;
}

/**
 * Transferência que a rede restringiu por política, sem reverter a transação.
 *
 * Semântica exigida de quem preenche isto: o valor NÃO chegou ao destinatário
 * pretendido. Uma rede onde a transferência bloqueada simplesmente reverte não
 * deve produzir esta observação - lá não há nada pro dono resgatar e o alerta
 * significaria outra coisa. Ver docs/ADAPTER_SPEC.md.
 */
export interface RestrictedTransferObservation extends NormalizedObservationBase {
  readonly kind: "transfer-restricted";
  /** valor restrito, na menor unidade do ativo */
  readonly amount: bigint;
  /**
   * Obrigatório aqui, ao contrário da base, por um motivo de produto e não de
   * tipagem: um valor restrito normalmente gera um recibo que o dono pode
   * resgatar depois (é o caso do TIP-403 na Tempo), e um alerta sobre um
   * bloqueio que o dono não consegue identificar na cadeia é um alerta sobre
   * o qual ele não tem como agir. Também é o que torna a observação
   * desduplicável - ver `observationKey`. Uma rede que restrinja
   * transferências sem oferecer nada que cumpra esse papel não deve usar esta
   * observação: deve declarar um `ProtocolSpecificObservation` próprio e
   * documentar a limitação.
   */
  readonly sequence: bigint;
}

/** Movimento de valor de/para o endereço monitorado. */
export interface AssetTransferObservation extends NormalizedObservationBase {
  readonly kind: "asset-transfer" | "balance-change";
  readonly amount: bigint;
  readonly direction: "in" | "out";
}

/** Troca de autoridade sobre o ativo monitorado (dono, signatário, recuperação). */
export interface AuthorityChangeObservation extends NormalizedObservationBase {
  readonly kind: "authority-change";
  readonly authorityKind: string;
}

/**
 * Observação cuja semântica não existe fora da rede de origem.
 *
 * O parâmetro de tipo é o ponto: uma extensão de rede carrega seu payload
 * TIPADO aqui (`ProtocolSpecificObservation<MeuEventoDaMinhaRede>`) sem
 * contaminar o núcleo genérico com campos que só uma rede preenche - era
 * exatamente isso que o import de `TransferBlockedEvent` em detection-rules.ts
 * fazia antes.
 */
export interface ProtocolSpecificObservation<T = unknown> extends NormalizedObservationBase {
  readonly kind: "protocol-specific";
  /** identificador do evento na rede de origem, ex: "tempo/TransferBlocked" */
  readonly protocolEvent: string;
  readonly payload: T;
}

export type NormalizedObservation =
  | RestrictedTransferObservation
  | AssetTransferObservation
  | AuthorityChangeObservation
  | ProtocolSpecificObservation;

/**
 * Chave estável de uma observação, pra desduplicar eventos repetidos e
 * reconhecer os que chegam fora de ordem.
 *
 * Necessária porque reentrega é o caso NORMAL, não excepcional: o monitor
 * repete intervalos de cursor depois de uma falha de ciclo (ver
 * monitor.ts#tick), e provedores de RPC devolvem o mesmo log duas vezes em
 * reorg. Sem uma chave, o mesmo bloqueio de transferência gera duas ligações
 * telefônicas pro dono - e um alerta que grita duas vezes pela mesma coisa
 * treina o usuário a ignorar o alerta.
 *
 * Devolve `null` - em vez de uma chave inventada a partir do cursor - quando a
 * rede não entrega `sequence` nem `txRef`. É uma declaração explícita de "esta
 * observação não é desduplicável", e o chamador tem que decidir o que fazer
 * com isso; uma chave falsa esconderia o problema e desduplicaria eventos
 * distintos que por acaso caíram no mesmo cursor.
 */
export function observationKey(observation: NormalizedObservation): string | null {
  const { chainKey, kind, sequence, txRef } = observation;
  if (sequence !== undefined) return `${chainKey}:${kind}:seq:${sequence}`;
  if (txRef !== undefined) return `${chainKey}:${kind}:tx:${txRef}:${observation.cursor}`;
  return null;
}
