/**
 * Ponto de entrada: conecta motor de detecção → regras → disparo de alerta
 * por ligação → confirmação de PIN via webhook. Caminho crítico ponta a
 * ponta, pensado pra testar e demonstrar antes de existir qualquer UI.
 *
 * Também prova em código a estratégia multi-track do pitch: o monitor da
 * Tempo usa o adaptador completo + extensão TransferBlocked; opcionalmente,
 * um segundo monitor roda em paralelo numa chain EVM genérica (Base) usando
 * só o núcleo comum, sem nenhuma linha de código específica da Tempo - ver
 * ARCHITECTURE.md e known-chains.ts.
 *
 * ⚠️ Antes de rodar contra a rede de verdade: confirme TEMPO_RECEIVE_POLICY_GUARD_ADDRESS
 * e o ABI em tempo.adapter.ts contra https://tempo.xyz/developers/docs/protocol/tip403/spec
 */

import "dotenv/config";
import type { Address } from "viem";
import { RECEIVE_POLICY_GUARD_ADDRESS, TempoAdapter } from "./engine/chains/tempo.adapter.js";
import { TempoBlockedTransferExtension } from "./engine/chains/tempo-extension.js";
import { EvmAdapter } from "./engine/chains/evm-adapter.js";
import { resolveRpcUrl } from "./engine/chains/known-chains.js";
import type { DetectionEvent, UserThresholds } from "./engine/rules/detection-rules.js";
import { Monitor } from "./monitor.js";
import { createTwilioVoiceClient } from "./alerts/twilio-voice.js";
import { generatePin, type PendingPin } from "./alerts/pin.js";
import { createWebhookServer, type PinStore } from "./webhook-server.js";
import { createDashboardServer } from "./dashboard/server.js";
import {
  InMemoryAccountDetailsRepository,
  InMemoryAlertLog,
  InMemoryUserRepository,
} from "./dashboard/in-memory-repositories.js";
import { randomUUID } from "node:crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

async function main() {
  // TODO produção: trocar pela leitura real de user_thresholds (ver mapping-schema.sql)
  // e pela lista real de destinatários cadastrados via PhoneMappingService.
  const thresholds: UserThresholds = {
    userId: "demo-user",
    maxBalanceDropPct: 20,
    windowMinutes: 10,
    blockedTransferAlertThreshold: 1_000_000n,
  };
  const alertRecipients = (process.env.DEMO_ALERT_NUMBERS ?? "").split(",").filter(Boolean);
  const watchedAddress = requireEnv("DEMO_WATCHED_ADDRESS") as Address;

  const voiceClient = createTwilioVoiceClient({
    accountSid: requireEnv("TWILIO_ACCOUNT_SID"),
    authToken: requireEnv("TWILIO_AUTH_TOKEN"),
    fromNumber: requireEnv("TWILIO_VOICE_NUMBER"),
    gatherActionUrl: `${requireEnv("PUBLIC_BASE_URL")}/webhooks/twilio/gather`,
  });

  const pinStore: PinStore = new Map();
  const alertLog = new InMemoryAlertLog();

  const dispatchAlert = async (event: DetectionEvent) => {
    const alertId = randomUUID();
    const pending: PendingPin = generatePin(alertId);
    pinStore.set(alertId, pending);
    alertLog.record(event.kind);

    console.log(`[alerta] disparando ${event.kind} (alertId=${alertId})`);

    // Demo manda o PIN por log - em produção isto vai por WhatsApp/SMS
    // separado do canal de voz, nunca junto da mesma ligação.
    console.log(`[alerta] PIN de confirmação: ${pending.pin} (expira ${pending.expiresAt.toISOString()})`);

    await voiceClient.placeAlertCall({ toNumbers: alertRecipients, event, alertId });
  };

  // --- Monitor principal: Tempo, com extensão TransferBlocked ---
  const tempoAdapter = new TempoAdapter({
    rpcUrl: requireEnv("TEMPO_RPC_URL"),
    chainId: Number(requireEnv("TEMPO_CHAIN_ID")),
    minConfirmations: 3,
    receivePolicyGuardAddress:
      (process.env.TEMPO_RECEIVE_POLICY_GUARD_ADDRESS as Address | undefined) ??
      RECEIVE_POLICY_GUARD_ADDRESS,
  });

  const tempoMonitor = new Monitor(
    tempoAdapter,
    {
      address: watchedAddress,
      thresholds,
      pollIntervalMs: 15_000,
    },
    dispatchAlert,
    new TempoBlockedTransferExtension(tempoAdapter),
  );

  const monitors = [tempoMonitor.start()];

  // --- Monitor secundário opcional: Base, núcleo genérico, SEM extensão ---
  // Prova em código a estratégia multi-track: zero linha de código específica
  // de chain além da config de RPC. Só ativa se o endereço de demo da 2ª
  // chain estiver configurado - não bloqueia quem só quer rodar Tempo.
  if (process.env.DEMO_SECOND_CHAIN_ADDRESS) {
    const baseAdapter = new EvmAdapter({
      rpcUrl: resolveRpcUrl("base", process.env.BASE_RPC_URL),
      chainId: 8453,
      minConfirmations: 3,
    });

    const baseMonitor = new Monitor(
      baseAdapter,
      {
        address: process.env.DEMO_SECOND_CHAIN_ADDRESS as Address,
        thresholds,
        pollIntervalMs: 15_000,
      },
      dispatchAlert,
      // sem extensão - Base não tem TransferBlocked nem equivalente
    );

    console.log("[monitor] segundo monitor ativo na Base (núcleo genérico, sem extensão)");
    monitors.push(baseMonitor.start());
  }

  const webhookServer = createWebhookServer(
    {
      port: Number(process.env.PORT ?? 3000),
      authToken: requireEnv("TWILIO_AUTH_TOKEN"),
      publicBaseUrl: requireEnv("PUBLIC_BASE_URL"),
    },
    pinStore,
    (alertId, result) => {
      console.log(`[webhook] alertId=${alertId} resultado do PIN: ${result}`);
    },
  );

  const port = Number(process.env.PORT ?? 3000);
  webhookServer.listen(port, () => console.log(`[webhook] escutando na porta ${port}`));

  // --- Painel (Dia 8): único lugar onde saldo/endereço completo aparece ---
  const users = new InMemoryUserRepository();
  const accounts = new InMemoryAccountDetailsRepository(
    watchedAddress,
    alertLog,
    async () => (await tempoAdapter.getBalance(watchedAddress)).raw,
  );

  const demoUsername = process.env.DEMO_DASHBOARD_USERNAME ?? "demo";
  const demoCredentials = users.createDemoUser(demoUsername);
  // Impresso uma única vez, no startup - nunca persistido em log/arquivo.
  // Produção: fluxo de cadastro real, nunca usuário gerado automaticamente.
  console.log("\n=== Credenciais de demo do painel (válidas só nesta execução) ===");
  console.log(`Usuário: ${demoCredentials.username}`);
  console.log(`Senha: ${demoCredentials.password}`);
  console.log(`Configure o TOTP no autenticador com: ${demoCredentials.otpAuthUri}`);
  console.log("===================================================================\n");

  const dashboardServer = createDashboardServer(users, accounts);
  const dashboardPort = Number(process.env.DASHBOARD_PORT ?? port + 1);
  dashboardServer.listen(dashboardPort, () =>
    console.log(`[painel] escutando na porta ${dashboardPort}`),
  );

  await Promise.all(monitors);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
