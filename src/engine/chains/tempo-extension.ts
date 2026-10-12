/**
 * Ponte entre o TempoAdapter (leitura/decodificação, sem saber de regras de
 * negócio) e as regras de detecção genéricas.
 *
 * Esta é a camada de TRADUÇÃO do padrão descrito em
 * `rules/normalized-events.ts`: ela converte o evento específico da Tempo
 * (`TransferBlockedEvent`, TIP-403) na observação normalizada que a regra
 * genérica consome (`RestrictedTransferObservation`). Antes, a regra genérica
 * importava o tipo da Tempo direto - o que obrigava qualquer outra rede a ou
 * imitar o formato da Tempo, ou editar o arquivo de regras do núcleo. A
 * tradução pertence aqui porque este é o único módulo que precisa conhecer as
 * duas pontas; manter isso aqui também evita o import circular que existiria
 * se tempo.adapter.ts passasse a depender de detection-rules.ts.
 *
 * Cada rede nova escreve a sua própria ponte equivalente, e nenhuma delas
 * mexe no núcleo - ver docs/DEVELOPING_ADAPTERS.md.
 */

import type { ChainExtension } from "../chain-extension.js";
import type { TempoAdapter, TransferBlockedEvent } from "./tempo.adapter.js";
import { checkRestrictedTransfer, type DetectionEvent, type UserThresholds } from "../rules/detection-rules.js";
import type { RestrictedTransferObservation } from "../rules/normalized-events.js";

/**
 * Converte o `TransferBlocked` da Tempo na observação normalizada.
 *
 * O witness decodificado (`receiptDecoded`, o ClaimReceiptV1 da TIP-1028) vai
 * inteiro pra `details`, não pra campos genéricos: motivo do bloqueio, tipo de
 * operação, memo e autoridade de recuperação são conceitos do TIP-403 que não
 * têm equivalente garantido em outra rede. Preserva o original pra auditoria
 * sem fingir que é informação genérica - e, como todo `details`, é DADO e
 * nunca comando (ver normalized-events.ts): nada ali decide severidade nem
 * entra em texto de alerta. A severidade sai só de `amount` contra os
 * limiares do usuário.
 */
export function toRestrictedTransferObservation(
  event: TransferBlockedEvent,
): RestrictedTransferObservation {
  return {
    kind: "transfer-restricted",
    chainKey: "tempo",
    cursor: event.blockNumber,
    sequence: event.blockedNonce,
    txRef: event.transactionHash,
    amount: event.amount,
    details: {
      protocolEvent: "tempo/TransferBlocked",
      token: event.token,
      receiver: event.receiver,
      receiptVersion: event.receiptVersion,
      receiptDecoded: event.receiptDecoded,
    },
  };
}

export class TempoBlockedTransferExtension implements ChainExtension {
  constructor(private readonly adapter: TempoAdapter) {}

  async checkExtra(fromBlock: bigint, toBlock: bigint, thresholds: UserThresholds): Promise<DetectionEvent[]> {
    const blocked = await this.adapter.getBlockedTransfers(fromBlock, toBlock);
    const events: DetectionEvent[] = [];

    for (const transfer of blocked) {
      const event = checkRestrictedTransfer(toRestrictedTransferObservation(transfer), thresholds);
      if (event) events.push(event);
    }

    return events;
  }
}
