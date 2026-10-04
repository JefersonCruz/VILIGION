/**
 * Contrato que qualquer chain pode implementar pra adicionar verificações
 * específicas de protocolo ao Monitor genérico (ex: o TransferBlocked da
 * Tempo). Chains sem particularidade nenhuma (Base, Arbitrum, Ethereum L1)
 * simplesmente não passam extensão nenhuma pro Monitor - ver monitor.ts e
 * ARCHITECTURE.md sobre o padrão "núcleo + adaptador".
 */

import type { DetectionEvent, UserThresholds } from "./rules/detection-rules.js";

export interface ChainExtension {
  /**
   * Verificações extras de protocolo entre dois blocos, já com os limiares
   * do usuário aplicados. `toBlock` é o bloco confirmado que o Monitor
   * ACABOU de calcular (ver monitor.ts#tick) - recebido explicitamente pra
   * evitar que a implementação pergunte "qual é o bloco confirmado agora"
   * de novo à RPC (achado de performance de 2026-10-03: essa segunda
   * chamada era pura duplicação, a resposta já estava em mãos).
   */
  checkExtra(fromBlock: bigint, toBlock: bigint, thresholds: UserThresholds): Promise<DetectionEvent[]>;
}
