/**
 * Núcleo genérico de leitura EVM, via RPC direto (nunca via indexer de terceiros
 * no caminho crítico do alerta — ver ARCHITECTURE.md sobre por quê).
 *
 * Qualquer chain EVM-compatível (Tempo, Base, Arbitrum, Ethereum L1) pode
 * implementar este contrato. Regras específicas de protocolo (ex: o
 * ReceivePolicyGuard da Tempo) NÃO pertencem aqui — ver chains/tempo.adapter.ts.
 */

import {
  type Address,
  type PublicClient,
  type Log,
  createPublicClient,
  http,
  isAddress,
  parseAbi,
} from "viem";
import type {
  AddressCheck,
  AdapterMetadata,
  BalanceSnapshot,
  ChainAddress,
  ChainCapabilities,
  MonitoredChainAdapter,
} from "./chain-adapter.js";

/**
 * Reexportado daqui por compatibilidade: `BalanceSnapshot` passou a morar em
 * `chain-adapter.ts` quando o tipo deixou de ser "snapshot de saldo EVM" e
 * virou parte do contrato comum a qualquer rede. Os chamadores existentes
 * (monitor.ts, rules/) seguem importando do mesmo lugar de antes.
 */
export type { BalanceSnapshot } from "./chain-adapter.js";

const ERC20_BALANCE_OF_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

/**
 * Limite conservador de blocos por chamada eth_getLogs. Provedores de RPC
 * costumam rejeitar ranges grandes (o da Tempo rejeita acima de 100.000,
 * achado em produção em 2026-10-07 - InvalidParamsRpcError "query exceeds
 * max block range 100000"); fica bem abaixo disso de propósito, como margem
 * de segurança. Única definição - monitor.ts reaproveita esta mesma
 * constante em vez de duplicar o número.
 */
export const MAX_LOG_RANGE_BLOCKS = 50_000n;

export interface EvmAdapterConfig {
  rpcUrl: string;
  chainId: number;
  /**
   * Profundidade mínima de confirmação antes de considerar um evento "real".
   * Protege contra disparar alerta falso por causa de reorg. Ver achado do
   * agente de segurança em SECURITY.md.
   */
  minConfirmations: number;
  /**
   * Endereço do contrato do token a monitorar (TIP-20/ERC-20), via
   * `balanceOf`. Quando ausente, `getBalance` lê o saldo NATIVO da chain
   * (`eth_getBalance`) — correto só em chains que têm moeda nativa de
   * verdade (Base, Arbitrum, Ethereum L1). Na Tempo, que não tem gas token
   * nativo, `eth_getBalance` NÃO reflete o saldo da tesouraria: confirmado
   * empiricamente contra a testnet Moderato (ver scripts/verify-testnet.ts)
   * — retorna um valor sem relação com saldo TIP-20 real. Pra Tempo, este
   * campo é obrigatório na prática.
   */
  tokenAddress?: Address;
  /**
   * Chave estável da rede (a mesma de `known-chains.ts` e da coluna
   * `monitored_accounts.chain_key`). Opcional pra não quebrar os chamadores
   * que já existiam antes do contrato comum; sem ela, o metadata cai num
   * identificador derivado do chainId, que serve pra log mas não pro registro.
   */
  chainKey?: string;
  displayName?: string;
}

/**
 * Capacidades de uma rede EVM "normal" - com moeda nativa de verdade, logs
 * históricos e possibilidade de reorg (Base, Arbitrum, Ethereum L1).
 *
 * `feePaidInMonitoredAsset: false` é o ponto que separa essas redes da Tempo:
 * a taxa sai da moeda nativa, nunca do token monitorado, então `getFeeAdjustment`
 * devolver `0n` aqui é a resposta CORRETA e não um placeholder. Ver
 * `TEMPO_CAPABILITIES` em tempo.adapter.ts pro contraste.
 */
export const GENERIC_EVM_CAPABILITIES: ChainCapabilities = {
  tokenBalance: true,
  nativeBalance: true,
  historicalEvents: true,
  feePaidInMonitoredAsset: false,
  reorgPossible: true,
  requiresTokenAddress: false,
};

/**
 * Adaptador EVM genérico. Cada chain concreta (ex: TempoAdapter) estende isto
 * e adiciona suas regras próprias de protocolo.
 *
 * Cumpre `MonitoredChainAdapter` - é a implementação de referência do contrato
 * comum, e a prova de que o contrato não foi desenhado em torno de uma rede
 * só (ver docs/ADAPTER_SPEC.md).
 */
/**
 * Validacao de endereco EVM, em funcao de modulo em vez de so metodo.
 *
 * Existe solta porque DOIS lugares precisam dela e nao podem divergir: o
 * adaptador (que o monitor usa) e a entrada do registro (que o formulario de
 * /accounts usa, sem poder construir um adaptador - construir exigiria URL de
 * RPC configurada so pra conferir um campo de texto). Duas copias da mesma
 * regra viram, com o tempo, duas regras diferentes - e a divergencia apareceria
 * como "o formulario aceitou, o monitor recusa", que e um painel degradado sem
 * explicacao.
 *
 * `chain-registry.test.ts` verifica que as duas pontas sao mesmo esta funcao,
 * pra toda rede registrada.
 *
 * Delega pro `isAddress` da viem - a MESMA funcao que `server.ts` chamava
 * direto antes de 23/10/2026, chamada do mesmo jeito (sem opcoes), pra que a
 * rigidez nao mude: 40 digitos hex, e maiuscula misturada so passa com
 * checksum EIP-55 valido (conferido contra a viem em 23/10/2026). Mover a
 * validacao de lugar nao e afrouxa-la.
 *
 * Normaliza pra MINUSCULO, nao pro checksum da viem. Nao e estetica:
 * `hashAddress` (privacy/signup-service.ts) deriva do endereco em minusculo a
 * chave de busca do mapeamento endereco -> telefone. Guardar a forma com
 * checksum mudaria essa chave e orfanaria os mapeamentos ja gravados - o dono
 * deixaria de receber ligacao e nada apontaria o motivo.
 *
 * `trim()` e novo: antes um endereco colado com espaco sobrando era recusado
 * com "endereco invalido", sem dizer que o problema era o espaco. Aparar antes
 * de validar nao aceita nada que a viem recusaria - o que vai pra `isAddress`
 * continua sendo o texto aparado.
 */
export function checkEvmAddress(raw: string): AddressCheck {
  const aparado = raw.trim();
  if (!isAddress(aparado)) {
    return {
      ok: false,
      reason:
        "precisa ser um endereço 0x com 40 caracteres hexadecimais " +
        "(se copiou com letras maiúsculas, o checksum tem que estar correto)",
    };
  }
  return { ok: true, normalized: aparado.toLowerCase() };
}

export class EvmAdapter implements MonitoredChainAdapter {
  protected readonly client: PublicClient;
  protected readonly config: EvmAdapterConfig;

  readonly metadata: AdapterMetadata;
  /** Sobrescrito por subclasse quando a rede foge do EVM "normal" - ver TempoAdapter. */
  readonly capabilities: ChainCapabilities = GENERIC_EVM_CAPABILITIES;
  readonly maxHistoryWindow: bigint = MAX_LOG_RANGE_BLOCKS;

  constructor(config: EvmAdapterConfig) {
    this.config = config;
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    }) as PublicClient;
    this.metadata = {
      chainKey: config.chainKey ?? `evm-${config.chainId}`,
      displayName: config.displayName ?? config.chainKey ?? `EVM chain ${config.chainId}`,
      family: "evm",
      chainId: config.chainId,
    };
  }

  /** Ver `checkEvmAddress` - o metodo so delega, pra que registro e adaptador usem a mesma regra. */
  checkAddress(raw: string): AddressCheck {
    return checkEvmAddress(raw);
  }

  /**
   * Lê o saldo do endereço: via `balanceOf` do token configurado
   * (`config.tokenAddress`) quando presente, ou saldo nativo (`eth_getBalance`)
   * caso contrário. Ver nota em `EvmAdapterConfig.tokenAddress` sobre por que
   * isso importa na Tempo.
   */
  async getBalance(address: ChainAddress): Promise<BalanceSnapshot> {
    /*
     * Estreita na fronteira, em vez de confiar no tipo. O nucleo passa
     * `ChainAddress` (string), e so este adaptador sabe o que e um endereco
     * valido nesta rede - entao se algum caminho chegar aqui sem ter passado
     * pelo formulario, a chamada RPC nao sai com texto malformado. Lanca, em
     * vez de devolver 0n, porque o contrato diz que "nao consegui ler" nunca
     * pode virar "nao houve movimento" (ver ChainCapabilities).
     */
    const conferido = this.checkAddress(address);
    if (!conferido.ok) {
      throw new Error(`Endereço inválido para "${this.metadata.chainKey}": ${conferido.reason}`);
    }
    const enderecoEvm = conferido.normalized as Address;
    const token = this.config.tokenAddress;
    const [raw, blockNumber] = await Promise.all([
      token
        ? this.rawReadTokenBalance(token, enderecoEvm)
        : this.rawReadNativeBalance(enderecoEvm),
      this.rawGetBlockNumber(),
    ]);

    return { address, raw, blockNumber, observedAt: new Date() };
  }

  /** Número do bloco mais recente já confirmado o suficiente pra confiar (ver minConfirmations). */
  async getConfirmedBlockNumber(): Promise<bigint> {
    const latest = await this.rawGetBlockNumber();
    const confirmed = latest - BigInt(this.config.minConfirmations);
    return confirmed > 0n ? confirmed : 0n;
  }

  /*
   * Os três seams abaixo existem pelo mesmo motivo que `rawGetLogs` (ver nota
   * nele): isolar cada chamada RPC crua num método substituível permite
   * testar a LÓGICA de `getBalance`/`getConfirmedBlockNumber` - a escolha
   * entre saldo de token e saldo nativo, o clamp do cursor em 0, a
   * propagação de erro - sem mockar o client do viem inteiro e sem tocar
   * rede. É o que a suíte de conformidade (adapter-conformance.ts) precisa
   * pra exercitar o caminho real em vez de uma reimplementação do fake.
   */

  /** Saldo de token via `balanceOf`. */
  protected async rawReadTokenBalance(token: Address, account: Address): Promise<bigint> {
    return this.client.readContract({
      address: token,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [account],
    });
  }

  /** Saldo da moeda nativa via `eth_getBalance` - ver a nota em `EvmAdapterConfig.tokenAddress`. */
  protected async rawReadNativeBalance(account: Address): Promise<bigint> {
    return this.client.getBalance({ address: account });
  }

  /** Altura atual da cadeia. */
  protected async rawGetBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  /**
   * Quanto do delta de saldo bruto entre dois blocos é só dedução de taxa
   * (não uma saída real de valor) - soma de volta pro saldo "ajustado" antes
   * de checkBalanceDrop, pra não confundir pagamento de taxa legítimo com
   * anomalia (ver monitor.ts#tick). Default genérico: 0 (nenhum ajuste) -
   * correto pra qualquer chain EVM com moeda nativa de verdade (Base,
   * Arbitrum, Ethereum L1), onde a taxa nunca sai do token monitorado.
   * TempoAdapter sobrescreve isto - é a única chain suportada sem gas token
   * nativo (ver ARCHITECTURE.md).
   */
  async getFeeAdjustment(_fromBlock: bigint, _toBlock: bigint, _address: ChainAddress): Promise<bigint> {
    return 0n;
  }

  /**
   * Observa logs de um contrato específico entre dois blocos, já aplicando a
   * profundidade mínima de confirmação. Chains específicas usam isto como
   * base para decodificar eventos próprios (ex: ReceivePolicyGuard na Tempo).
   *
   * Pagina internamente em janelas de MAX_LOG_RANGE_BLOCKS (achado de
   * produção 2026-10-07, issue #8): antes, um range maior que o limite do
   * provedor RPC falhava sempre, numa chamada só. monitor.ts já limita o
   * TAMANHO do gap que tenta recuperar por ciclo (política de "prefiro
   * perder evento antigo a travar pra sempre") - isto aqui é a camada de
   * baixo que garante que QUALQUER range pedido, de qualquer chamador atual
   * ou futuro (ex: getFeeAdjustment em tempo.adapter.ts, que não tinha
   * nenhuma proteção própria), nunca estoura o limite do RPC numa chamada só.
   */
  async getConfirmedLogs(params: {
    address: Address;
    fromBlock: bigint;
    toBlock?: bigint;
  }): Promise<Log[]> {
    const confirmedTo = params.toBlock ?? (await this.getConfirmedBlockNumber());
    if (confirmedTo < params.fromBlock) return [];

    const logs: Log[] = [];
    let chunkStart = params.fromBlock;
    while (chunkStart <= confirmedTo) {
      const remaining = confirmedTo - chunkStart + 1n;
      const chunkEnd = remaining > MAX_LOG_RANGE_BLOCKS ? chunkStart + MAX_LOG_RANGE_BLOCKS - 1n : confirmedTo;
      const chunkLogs = await this.rawGetLogs({ address: params.address, fromBlock: chunkStart, toBlock: chunkEnd });
      logs.push(...chunkLogs);
      chunkStart = chunkEnd + 1n;
    }
    return logs;
  }

  /** Chamada RPC crua, isolada só pra poder ser substituída em teste (ver evm-adapter.test.ts) sem mockar o client inteiro. */
  protected async rawGetLogs(params: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<Log[]> {
    return this.client.getLogs(params);
  }
}
