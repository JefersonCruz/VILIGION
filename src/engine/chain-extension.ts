/**
 * Contrato que qualquer chain pode implementar pra adicionar verificações
 * específicas de protocolo ao Monitor genérico (ex: o TransferBlocked da
 * Tempo). Chains sem particularidade nenhuma (Base, Arbitrum, Ethereum L1)
 * simplesmente não passam extensão nenhuma pro Monitor - ver monitor.ts e
 * ARCHITECTURE.md sobre o padrão "núcleo + adaptador".
 */

import type { DetectionEvent, UserThresholds } from "./rules/detection-rules.js";

export interface ChainExtension {
  /** Verificações extras de protocolo desde um bloco, já com os limiares do usuário aplicados. */
  checkExtra(fromBlock: bigint, thresholds: UserThresholds): Promise<DetectionEvent[]>;
}
