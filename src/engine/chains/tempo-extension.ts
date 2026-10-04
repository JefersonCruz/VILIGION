/**
 * Une o TempoAdapter (leitura/decodificação, sem saber de regras de negócio)
 * com as regras de detecção (checkBlockedTransfer) - mantém tempo.adapter.ts
 * livre de depender de detection-rules.ts, evitando import circular
 * (detection-rules.ts já depende de tempo.adapter.ts pro tipo TransferBlockedEvent).
 */

import type { ChainExtension } from "../chain-extension.js";
import type { TempoAdapter } from "./tempo.adapter.js";
import { checkBlockedTransfer, type DetectionEvent, type UserThresholds } from "../rules/detection-rules.js";

export class TempoBlockedTransferExtension implements ChainExtension {
  constructor(private readonly adapter: TempoAdapter) {}

  async checkExtra(fromBlock: bigint, toBlock: bigint, thresholds: UserThresholds): Promise<DetectionEvent[]> {
    const blocked = await this.adapter.getBlockedTransfers(fromBlock, toBlock);
    const events: DetectionEvent[] = [];

    for (const transfer of blocked) {
      const event = checkBlockedTransfer(transfer, thresholds);
      if (event) events.push(event);
    }

    return events;
  }
}
