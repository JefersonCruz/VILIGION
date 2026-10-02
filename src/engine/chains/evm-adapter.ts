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
} from "viem";

export interface BalanceSnapshot {
  address: Address;
  /** saldo bruto, na menor unidade do token monitorado */
  raw: bigint;
  blockNumber: bigint;
  /** quando essa leitura foi feita, pra permitir detectar atraso de indexação */
  observedAt: Date;
}

export interface EvmAdapterConfig {
  rpcUrl: string;
  chainId: number;
  /**
   * Profundidade mínima de confirmação antes de considerar um evento "real".
   * Protege contra disparar alerta falso por causa de reorg. Ver achado do
   * agente de segurança em SECURITY.md.
   */
  minConfirmations: number;
}

/**
 * Adaptador EVM genérico. Cada chain concreta (ex: TempoAdapter) estende isto
 * e adiciona suas regras próprias de protocolo.
 */
export class EvmAdapter {
  protected readonly client: PublicClient;
  protected readonly config: EvmAdapterConfig;

  constructor(config: EvmAdapterConfig) {
    this.config = config;
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    }) as PublicClient;
  }

  /** Lê o saldo nativo do endereço. Para tokens TIP-20/ERC-20, ver o adaptador específico. */
  async getBalance(address: Address): Promise<BalanceSnapshot> {
    const [raw, blockNumber] = await Promise.all([
      this.client.getBalance({ address }),
      this.client.getBlockNumber(),
    ]);

    return { address, raw, blockNumber, observedAt: new Date() };
  }

  /** Número do bloco mais recente já confirmado o suficiente pra confiar (ver minConfirmations). */
  async getConfirmedBlockNumber(): Promise<bigint> {
    const latest = await this.client.getBlockNumber();
    const confirmed = latest - BigInt(this.config.minConfirmations);
    return confirmed > 0n ? confirmed : 0n;
  }

  /**
   * Observa logs de um contrato específico entre dois blocos, já aplicando a
   * profundidade mínima de confirmação. Chains específicas usam isto como
   * base para decodificar eventos próprios (ex: ReceivePolicyGuard na Tempo).
   */
  async getConfirmedLogs(params: {
    address: Address;
    fromBlock: bigint;
    toBlock?: bigint;
  }): Promise<Log[]> {
    const confirmedTo = params.toBlock ?? (await this.getConfirmedBlockNumber());
    if (confirmedTo < params.fromBlock) return [];

    return this.client.getLogs({
      address: params.address,
      fromBlock: params.fromBlock,
      toBlock: confirmedTo,
    });
  }
}
