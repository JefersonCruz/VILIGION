/**
 * Ponto de entrada: conecta motor de detecção → regras → disparo de alerta
 * por ligação/e-mail → confirmação de PIN via webhook → painel web.
 *
 * Dois caminhos de bootstrap:
 * - SEM DATABASE_URL: modo demo - um monitor fixo (env vars), repositórios
 *   em memória. Zero dependência externa além de RPC, pra rodar/validar
 *   antes de configurar Postgres.
 * - COM DATABASE_URL: modo real - lê TODAS as contas monitoradas de TODOS
 *   os usuários na tabela monitored_accounts e levanta um Monitor por
 *   linha (qualquer chain EVM-compatível + qualquer token, ver
 *   docs/UI-SPEC.md), painel com cadastro/login/contas/limiares de
 *   verdade via Postgres.
 *
 * ⚠️ Antes de rodar contra a rede de verdade: confirme TEMPO_RECEIVE_POLICY_GUARD_ADDRESS
 * e o ABI em tempo.adapter.ts contra https://tempo.xyz/developers/docs/protocol/tip403/spec
 */

import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { Pool } from "pg";
import { Addresses } from "viem/tempo";
import { RECEIVE_POLICY_GUARD_ADDRESS, TempoAdapter } from "./engine/chains/tempo.adapter.js";
import { TempoBlockedTransferExtension } from "./engine/chains/tempo-extension.js";
import { EvmAdapter } from "./engine/chains/evm-adapter.js";
import { getKnownChain, resolveRpcUrl } from "./engine/chains/known-chains.js";
import type { DetectionEvent, UserThresholds } from "./engine/rules/detection-rules.js";
import { Monitor } from "./monitor.js";
import { createTwilioVoiceClient } from "./alerts/twilio-voice.js";
import { createEmailNotifier } from "./alerts/email-notifier.js";
import { generatePin, type PendingPin } from "./alerts/pin.js";
import { handleWebhookRequest, type PinStore, type WebhookServerConfig } from "./webhook-server.js";
import { createDashboardRequestHandler, type DashboardServerDeps } from "./dashboard/server.js";
import {
  InMemoryAccountDetailsRepository,
  InMemoryAlertLog,
  InMemoryMonitoredAccountsRepository,
  InMemoryPhoneMappingRepository,
  InMemoryRecipientsRepository,
  InMemoryThresholdsRepository,
  InMemoryUserRepository,
} from "./dashboard/in-memory-repositories.js";
import {
  PostgresAlertLog,
  PostgresDashboardUserRepository,
  PostgresMonitoredAccountRepository,
  PostgresPhoneMappingRepository,
  PostgresRecipientsRepository,
  PostgresThresholdsRepository,
  type MonitoredAccountRow,
} from "./db/postgres-repositories.js";
import { PhoneMappingService } from "./privacy/phone-mapping.js";
import { MappingEncryption, LocalDevKeyProvider } from "./privacy/encryption.js";
import { SignupService } from "./privacy/signup-service.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

/**
 * Twilio fica OPCIONAL de propósito - decisão de produto: ligação telefônica
 * é o canal de severidade "critical", e custa dinheiro + fica registrada na
 * operadora por anos (ver SECURITY.md). Até configurar uma conta Twilio de
 * verdade, alertas críticos só avisam no log em vez de travar a aplicação
 * inteira - o canal "normal" (e-mail) funciona independente disso.
 */
function buildVoiceClientIfConfigured() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_VOICE_NUMBER;
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!accountSid || !authToken || !fromNumber || !publicBaseUrl) return null;

  return createTwilioVoiceClient({
    accountSid,
    authToken,
    fromNumber,
    gatherActionUrl: `${publicBaseUrl}/webhooks/twilio/gather`,
    twimlUrl: `${publicBaseUrl}/webhooks/twilio/voice`,
    whatsappFromNumber: process.env.TWILIO_WHATSAPP_NUMBER,
    whatsappContentSid: process.env.TWILIO_WHATSAPP_CONTENT_SID,
  });
}

/** Mesma lógica de opcionalidade do voice client, pro canal "normal" (e-mail). */
function buildEmailNotifierIfConfigured() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromAddress = process.env.SMTP_FROM_ADDRESS;
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !fromAddress) return null;

  return createEmailNotifier({
    smtpHost,
    smtpPort: Number(smtpPort),
    smtpUser,
    smtpPass,
    fromAddress,
  });
}

/**
 * Webhook da Twilio + painel na MESMA porta/domínio público, de propósito:
 * a maioria dos hosts gratuitos/baratos (Railway incluso - confirmado na
 * prática) só libera um domínio público por serviço. Antes disso eram dois
 * `http.Server` em portas separadas (`PORT`/`DASHBOARD_PORT`); agora é um
 * só, tentando a rota de webhook primeiro e caindo pro painel - ver
 * webhook-server.ts#handleWebhookRequest e dashboard/server.ts#createDashboardRequestHandler.
 */
function startCombinedServer(
  pinStore: PinStore,
  onPinResult: (alertId: string, result: string) => void,
  dashboardDeps: DashboardServerDeps,
) {
  const port = Number(process.env.PORT ?? 3000);
  const webhookConfig: WebhookServerConfig = {
    port,
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "dev-sem-twilio",
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
  };
  const dashboardHandler = createDashboardRequestHandler(dashboardDeps);

  const server = createServer(async (req, res) => {
    const handledByWebhook = await handleWebhookRequest(req, res, webhookConfig, pinStore, onPinResult);
    if (!handledByWebhook) await dashboardHandler(req, res);
  });

  server.listen(port, () => console.log(`[servidor] painel + webhook escutando na porta ${port}`));
  return port;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    await mainWithDatabase(databaseUrl);
  } else {
    console.log("[boot] DATABASE_URL não configurado - rodando em modo demo (monitor único, repositórios em memória).");
    await mainDemo();
  }
}

// ---------------------------------------------------------------------------
// Modo demo: sem Postgres, um monitor fixo via variável de ambiente.
// ---------------------------------------------------------------------------
async function mainDemo() {
  const thresholds: UserThresholds = {
    userId: "demo-user",
    maxBalanceDropPct: 20,
    criticalBalanceDropPct: 50,
    windowMinutes: 10,
    blockedTransferAlertThreshold: 1_000_000n,
    criticalBlockedTransferThreshold: 10_000_000n,
  };
  const watchedAddress = requireEnv("DEMO_WATCHED_ADDRESS") as Address;
  const encryption = new MappingEncryption(new LocalDevKeyProvider());

  // Destinatários cadastrados no painel (/recipients) - as env vars abaixo
  // só semeiam o estado inicial da demo, pra manter o comportamento de antes
  // sem precisar configurar nada na primeira execução; dali em diante, o
  // dispatcher consulta o repositório a cada alerta, não um array fixo
  // capturado no boot (ver ARCHITECTURE.md/UI-SPEC.md - gap agora fechado).
  // Criptografado com o mesmo esquema de phone_mappings (ver mapping-schema.sql).
  const recipients = new InMemoryRecipientsRepository(encryption);
  for (const value of (process.env.DEMO_ALERT_NUMBERS ?? "").split(",").filter(Boolean)) {
    await recipients.add({ userId: thresholds.userId, kind: "phone", value });
  }
  for (const value of (process.env.DEMO_ALERT_EMAILS ?? "").split(",").filter(Boolean)) {
    await recipients.add({ userId: thresholds.userId, kind: "email", value });
  }

  const voiceClient = buildVoiceClientIfConfigured();
  const emailNotifier = buildEmailNotifierIfConfigured();
  console.log(`[alertas] canal crítico (ligação): ${voiceClient ? "ativo" : "NÃO configurado - só logará"}`);
  console.log(`[alertas] canal normal (e-mail): ${emailNotifier ? "ativo" : "NÃO configurado - só logará"}`);

  const pinStore: PinStore = new Map();
  const alertLog = new InMemoryAlertLog();

  const dispatchAlert = async (event: DetectionEvent) => {
    const alertId = randomUUID();
    console.log(`[alerta] disparando ${event.kind} (severidade=${event.severity}, alertId=${alertId})`);

    if (event.severity === "critical") {
      alertLog.record({ alertId, userId: thresholds.userId, kind: event.kind, severity: "critical", deliveredVia: "voice" });
      const pending: PendingPin = generatePin(alertId);
      pinStore.set(alertId, pending);
      console.log(`[alerta] PIN de confirmação: ${pending.pin} (expira ${pending.expiresAt.toISOString()})`);

      if (voiceClient) {
        const toNumbers = (await recipients.listForUser(thresholds.userId)).filter((r) => r.kind === "phone").map((r) => r.value);
        await voiceClient.placeAlertCall({ toNumbers, event, alertId, pin: pending.pin });
      } else {
        console.log("[alerta] ligação NÃO disparada - Twilio ainda não configurado (ver .env.example)");
      }
      return;
    }

    alertLog.record({ alertId, userId: thresholds.userId, kind: event.kind, severity: "normal", deliveredVia: "email" });
    if (emailNotifier) {
      const toAddresses = (await recipients.listForUser(thresholds.userId)).filter((r) => r.kind === "email").map((r) => r.value);
      await emailNotifier.sendAlertEmail({ toAddresses, event });
    } else {
      console.log("[alerta] e-mail NÃO enviado - SMTP ainda não configurado (ver .env.example)");
    }
  };

  const tempoAdapter = new TempoAdapter({
    rpcUrl: requireEnv("TEMPO_RPC_URL"),
    chainId: Number(requireEnv("TEMPO_CHAIN_ID")),
    minConfirmations: 3,
    receivePolicyGuardAddress:
      (process.env.TEMPO_RECEIVE_POLICY_GUARD_ADDRESS as Address | undefined) ?? RECEIVE_POLICY_GUARD_ADDRESS,
    tokenAddress: (process.env.TEMPO_WATCHED_TOKEN_ADDRESS as Address | undefined) ?? (Addresses.pathUsd as Address),
  });

  const tempoMonitor = new Monitor(
    tempoAdapter,
    { address: watchedAddress, thresholds, pollIntervalMs: 15_000 },
    dispatchAlert,
    new TempoBlockedTransferExtension(tempoAdapter),
  );
  const monitors = [tempoMonitor.start()];

  if (process.env.DEMO_SECOND_CHAIN_ADDRESS) {
    const baseAdapter = new EvmAdapter({
      rpcUrl: resolveRpcUrl("base", process.env.BASE_RPC_URL),
      chainId: 8453,
      minConfirmations: 3,
    });
    const baseMonitor = new Monitor(
      baseAdapter,
      { address: process.env.DEMO_SECOND_CHAIN_ADDRESS as Address, thresholds, pollIntervalMs: 15_000 },
      dispatchAlert,
    );
    console.log("[monitor] segundo monitor ativo na Base (núcleo genérico, sem extensão)");
    monitors.push(baseMonitor.start());
  }

  const users = new InMemoryUserRepository();
  const accounts = new InMemoryAccountDetailsRepository(watchedAddress, alertLog, async () => (await tempoAdapter.getBalance(watchedAddress)).raw);
  const monitoredAccounts = new InMemoryMonitoredAccountsRepository();
  const thresholdsRepo = new InMemoryThresholdsRepository();
  await thresholdsRepo.upsert(thresholds);
  const phoneMappingRepo = new InMemoryPhoneMappingRepository();
  const signupService = new SignupService(new PhoneMappingService(encryption), phoneMappingRepo, users, thresholdsRepo);

  const demoCredentials = users.createDemoUser(process.env.DEMO_DASHBOARD_USERNAME ?? "demo", thresholds.userId);
  console.log("\n=== Credenciais de demo do painel (válidas só nesta execução) ===");
  console.log(`Usuário: ${demoCredentials.username}`);
  console.log(`Senha: ${demoCredentials.password}`);
  console.log(`Configure o TOTP no autenticador com: ${demoCredentials.otpAuthUri}`);
  console.log("===================================================================\n");

  // No-op documentado: no modo demo, "/accounts" sempre foi só uma lista de
  // bookkeeping (InMemoryMonitoredAccountsRepository) nunca conectada a um
  // monitor de verdade - o único monitor real do modo demo é o fixo (Tempo,
  // via DEMO_WATCHED_ADDRESS) + o opcional da Base, ambos já subidos acima.
  // Diferente do modo com Postgres (ver mainWithDatabase), onde isto agora
  // sobe/para um Monitor de verdade em tempo real (achado de capacidade de
  // 2026-10-04).
  const monitorControl: DashboardServerDeps["monitorControl"] = {
    async start() {
      console.log("[monitor] modo demo não sobe monitor dinâmico - só a conta fixa de DEMO_WATCHED_ADDRESS é monitorada de verdade.");
    },
    async stop() {},
  };

  startCombinedServer(
    pinStore,
    (alertId, result) => {
      alertLog.updatePinStatus(alertId, result);
      console.log(`[webhook] alertId=${alertId} resultado do PIN: ${result}`);
    },
    { users, accounts, monitoredAccounts, thresholds: thresholdsRepo, alertHistory: alertLog, signup: signupService, recipients, monitorControl },
  );

  await Promise.all(monitors);
}

// ---------------------------------------------------------------------------
// Modo real: Postgres, multi-usuário, multi-chain/token (docs/UI-SPEC.md).
// ---------------------------------------------------------------------------
async function mainWithDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });

  const phoneMappingRepo = new PostgresPhoneMappingRepository(pool);
  const dashboardUsers = new PostgresDashboardUserRepository(pool);
  const monitoredAccounts = new PostgresMonitoredAccountRepository(pool);
  const thresholdsRepo = new PostgresThresholdsRepository(pool);
  const alertLog = new PostgresAlertLog(pool);
  // ⚠️ LocalDevKeyProvider NUNCA é seguro pra dado real de usuário (ver encryption.ts)
  // - nenhum KeyProvider de KMS de verdade (AWS/GCP) foi implementado ainda,
  // gap real documentado, não escondido. Sem ENCRYPTION_KEY_KMS_ARN definido
  // como chave hex de teste, uma chave aleatória nova é gerada a cada boot -
  // o que torna qualquer phone_mapping já persistido ilegível após reiniciar.
  // Pra persistir de verdade em dev, defina uma chave de teste fixa nessa
  // variável (ver .env.example). Antes de produção com dado real, trocar
  // LocalDevKeyProvider por um KeyProvider que use @aws-sdk/client-kms.
  if (!process.env.ENCRYPTION_KEY_KMS_ARN) {
    console.warn(
      "[privacidade] ENCRYPTION_KEY_KMS_ARN não definido - chave de criptografia é gerada nova a cada boot, " +
        "phone_mappings já salvos ficam ilegíveis após reiniciar. Defina uma chave hex de teste pra persistir entre boots.",
    );
  }
  const encryption = new MappingEncryption(new LocalDevKeyProvider(process.env.ENCRYPTION_KEY_KMS_ARN));
  const signupService = new SignupService(new PhoneMappingService(encryption), phoneMappingRepo, dashboardUsers, thresholdsRepo);
  // Mesmo MappingEncryption de phone_mappings - ver nota em mapping-schema.sql sobre por que o destino não fica em texto puro.
  const recipientsRepo = new PostgresRecipientsRepository(pool, encryption);

  const voiceClient = buildVoiceClientIfConfigured();
  const emailNotifier = buildEmailNotifierIfConfigured();
  console.log(`[alertas] canal crítico (ligação): ${voiceClient ? "ativo" : "NÃO configurado - só logará"}`);
  console.log(`[alertas] canal normal (e-mail): ${emailNotifier ? "ativo" : "NÃO configurado - só logará"}`);

  const pinStore: PinStore = new Map();

  /** Destinatários lidos do banco A CADA alerta (não capturados no boot) - cadastrados por usuário via /recipients. */
  function makeDispatcher(userId: string) {
    return async (event: DetectionEvent) => {
      const alertId = randomUUID();
      const deliveredVia = event.severity === "critical" ? "voice" : "email";
      await alertLog.record({ alertId, userId, kind: event.kind, severity: event.severity, deliveredVia });
      console.log(`[alerta] user=${userId} ${event.kind} (severidade=${event.severity}, alertId=${alertId})`);

      if (event.severity === "critical") {
        const pending: PendingPin = generatePin(alertId);
        pinStore.set(alertId, pending);
        if (voiceClient) {
          const toNumbers = (await recipientsRepo.listForUser(userId)).filter((r) => r.kind === "phone").map((r) => r.value);
          await voiceClient.placeAlertCall({ toNumbers, event, alertId, pin: pending.pin });
        } else {
          console.log("[alerta] ligação NÃO disparada - Twilio ainda não configurado");
        }
        return;
      }

      if (emailNotifier) {
        const toAddresses = (await recipientsRepo.listForUser(userId)).filter((r) => r.kind === "email").map((r) => r.value);
        await emailNotifier.sendAlertEmail({ toAddresses, event });
      } else {
        console.log("[alerta] e-mail NÃO enviado - SMTP ainda não configurado");
      }
    };
  }

  // Registro das instâncias de Monitor vivas por accountId - permite subir
  // ou parar uma conta em tempo real (via monitorControl, usado pelo
  // painel) sem precisar reiniciar o processo inteiro. Antes, `/accounts`
  // só gravava no banco; a conta só passava a ser monitorada no próximo
  // boot (ver docs/DEPLOYMENT.md, nota "O monitor só lê contas novas no
  // boot" - comportamento agora restrito ao modo demo, ver mainDemo abaixo).
  const liveMonitors = new Map<string, Monitor>();

  async function bootMonitor(account: MonitoredAccountRow): Promise<void> {
    const monitor = await startMonitorForAccount(account, thresholdsRepo, makeDispatcher(account.userId));
    liveMonitors.set(account.id, monitor);
    monitor.start().catch((err) => console.error(`[monitor] erro fatal na conta ${account.id}:`, err));
  }

  const monitorControl: DashboardServerDeps["monitorControl"] = {
    start: bootMonitor,
    async stop(accountId) {
      const monitor = liveMonitors.get(accountId);
      if (!monitor) return;
      monitor.stop();
      liveMonitors.delete(accountId);
    },
  };

  const allAccounts = await monitoredAccounts.listAll();
  console.log(`[boot] ${allAccounts.length} conta(s) monitorada(s) encontrada(s) no banco.`);
  await Promise.all(allAccounts.map(bootMonitor));

  const accountsDetailsRepo = {
    async getDetails(userId: string) {
      const userAccounts = await monitoredAccounts.listForUser(userId);
      const primary = userAccounts[0];
      if (!primary) {
        return { address: "(nenhuma conta monitorada ainda)", balanceRaw: "0", lastAlerts: [] };
      }
      const chain = getKnownChain(primary.chainKey);
      const adapter = new EvmAdapter({
        rpcUrl: resolveRpcUrl(primary.chainKey, undefined),
        chainId: chain.chainId,
        minConfirmations: 3,
        tokenAddress: primary.tokenAddress as Address,
      });
      const balance = await adapter.getBalance(primary.watchedAddress as Address);
      const recent = await alertLog.recentForUser(userId);
      return {
        address: primary.watchedAddress,
        balanceRaw: balance.raw.toString(),
        lastAlerts: recent.map((r) => ({ kind: r.kind, createdAt: r.createdAt.toISOString() })),
      };
    },
  };

  startCombinedServer(
    pinStore,
    (alertId, result) => {
      alertLog.updatePinStatus(alertId, result).catch((err) => console.error("[webhook] falha ao gravar pin_status:", err));
      console.log(`[webhook] alertId=${alertId} resultado do PIN: ${result}`);
    },
    {
      users: dashboardUsers,
      accounts: accountsDetailsRepo,
      monitoredAccounts,
      thresholds: thresholdsRepo,
      alertHistory: alertLog,
      signup: signupService,
      recipients: recipientsRepo,
      monitorControl,
    },
  );
}

/**
 * Constrói e sobe o Monitor de uma conta - devolve a instância (não só a
 * promise de execução) pra quem chamar poder parar depois (`monitor.stop()`)
 * sem precisar reiniciar o processo. Antes disto era uma IIFE que só
 * devolvia `{ run }`, sem expor o Monitor - correto pro boot (que nunca
 * precisava parar nada), mas incompatível com registrar/remover conta em
 * tempo real via `/accounts` (achado de capacidade de 2026-10-04).
 */
async function startMonitorForAccount(
  account: MonitoredAccountRow,
  thresholdsRepo: PostgresThresholdsRepository,
  dispatchAlert: (event: DetectionEvent) => Promise<void>,
): Promise<Monitor> {
  const chain = getKnownChain(account.chainKey);
  const rpcUrl = resolveRpcUrl(account.chainKey, undefined);
  const thresholds =
    (await thresholdsRepo.get(account.userId)) ?? {
      userId: account.userId,
      maxBalanceDropPct: 20,
      criticalBalanceDropPct: 50,
      windowMinutes: 10,
      blockedTransferAlertThreshold: 1_000_000n,
      criticalBlockedTransferThreshold: 10_000_000n,
    };

  if (account.chainKey === "tempo") {
    const adapter = new TempoAdapter({
      rpcUrl,
      chainId: chain.chainId,
      minConfirmations: 3,
      receivePolicyGuardAddress: RECEIVE_POLICY_GUARD_ADDRESS,
      tokenAddress: account.tokenAddress as Address,
    });
    const monitor = new Monitor(
      adapter,
      { address: account.watchedAddress as Address, thresholds, pollIntervalMs: 15_000 },
      dispatchAlert,
      new TempoBlockedTransferExtension(adapter),
    );
    console.log(`[monitor] ativo: usuário=${account.userId} chain=tempo token=${account.tokenAddress}`);
    return monitor;
  }

  const adapter = new EvmAdapter({ rpcUrl, chainId: chain.chainId, minConfirmations: 3, tokenAddress: account.tokenAddress as Address });
  const monitor = new Monitor(adapter, { address: account.watchedAddress as Address, thresholds, pollIntervalMs: 15_000 }, dispatchAlert);
  console.log(`[monitor] ativo: usuário=${account.userId} chain=${account.chainKey} token=${account.tokenAddress}`);
  return monitor;
}


main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
