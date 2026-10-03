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
import { createWebhookServer, type PinStore } from "./webhook-server.js";
import { createDashboardServer, type DashboardServerDeps } from "./dashboard/server.js";
import {
  InMemoryAccountDetailsRepository,
  InMemoryAlertLog,
  InMemoryMonitoredAccountsRepository,
  InMemoryPhoneMappingRepository,
  InMemoryThresholdsRepository,
  InMemoryUserRepository,
} from "./dashboard/in-memory-repositories.js";
import {
  PostgresAlertLog,
  PostgresDashboardUserRepository,
  PostgresMonitoredAccountRepository,
  PostgresPhoneMappingRepository,
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

/** Levanta o servidor de webhook (confirmação de PIN da Twilio) - igual nos dois modos. */
function startWebhookServer(pinStore: PinStore, onPinResult: (alertId: string, result: string) => void) {
  const port = Number(process.env.PORT ?? 3000);
  const webhookServer = createWebhookServer(
    {
      port,
      authToken: process.env.TWILIO_AUTH_TOKEN ?? "dev-sem-twilio",
      publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    },
    pinStore,
    onPinResult,
  );
  webhookServer.listen(port, () => console.log(`[webhook] escutando na porta ${port}`));
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
  const alertPhoneNumbers = (process.env.DEMO_ALERT_NUMBERS ?? "").split(",").filter(Boolean);
  const alertEmails = (process.env.DEMO_ALERT_EMAILS ?? "").split(",").filter(Boolean);
  const watchedAddress = requireEnv("DEMO_WATCHED_ADDRESS") as Address;

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
        await voiceClient.placeAlertCall({ toNumbers: alertPhoneNumbers, event, alertId });
      } else {
        console.log("[alerta] ligação NÃO disparada - Twilio ainda não configurado (ver .env.example)");
      }
      return;
    }

    alertLog.record({ alertId, userId: thresholds.userId, kind: event.kind, severity: "normal", deliveredVia: "email" });
    if (emailNotifier) {
      await emailNotifier.sendAlertEmail({ toAddresses: alertEmails, event });
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

  startWebhookServer(pinStore, (alertId, result) => {
    alertLog.updatePinStatus(alertId, result);
    console.log(`[webhook] alertId=${alertId} resultado do PIN: ${result}`);
  });

  const users = new InMemoryUserRepository();
  const accounts = new InMemoryAccountDetailsRepository(watchedAddress, alertLog, async () => (await tempoAdapter.getBalance(watchedAddress)).raw);
  const monitoredAccounts = new InMemoryMonitoredAccountsRepository();
  const thresholdsRepo = new InMemoryThresholdsRepository();
  await thresholdsRepo.upsert(thresholds);
  const phoneMappingRepo = new InMemoryPhoneMappingRepository();
  const encryption = new MappingEncryption(new LocalDevKeyProvider());
  const signupService = new SignupService(new PhoneMappingService(encryption), phoneMappingRepo, users, thresholdsRepo);

  const demoCredentials = users.createDemoUser(process.env.DEMO_DASHBOARD_USERNAME ?? "demo");
  console.log("\n=== Credenciais de demo do painel (válidas só nesta execução) ===");
  console.log(`Usuário: ${demoCredentials.username}`);
  console.log(`Senha: ${demoCredentials.password}`);
  console.log(`Configure o TOTP no autenticador com: ${demoCredentials.otpAuthUri}`);
  console.log("===================================================================\n");

  startDashboard({ users, accounts, monitoredAccounts, thresholds: thresholdsRepo, alertHistory: alertLog, signup: signupService });

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

  const voiceClient = buildVoiceClientIfConfigured();
  const emailNotifier = buildEmailNotifierIfConfigured();
  console.log(`[alertas] canal crítico (ligação): ${voiceClient ? "ativo" : "NÃO configurado - só logará"}`);
  console.log(`[alertas] canal normal (e-mail): ${emailNotifier ? "ativo" : "NÃO configurado - só logará"}`);

  const pinStore: PinStore = new Map();

  function makeDispatcher(userId: string, alertPhoneNumbers: string[], alertEmails: string[]) {
    return async (event: DetectionEvent) => {
      const alertId = randomUUID();
      const deliveredVia = event.severity === "critical" ? "voice" : "email";
      await alertLog.record({ alertId, userId, kind: event.kind, severity: event.severity, deliveredVia });
      console.log(`[alerta] user=${userId} ${event.kind} (severidade=${event.severity}, alertId=${alertId})`);

      if (event.severity === "critical") {
        const pending: PendingPin = generatePin(alertId);
        pinStore.set(alertId, pending);
        if (voiceClient) {
          await voiceClient.placeAlertCall({ toNumbers: alertPhoneNumbers, event, alertId });
        } else {
          console.log("[alerta] ligação NÃO disparada - Twilio ainda não configurado");
        }
        return;
      }

      if (emailNotifier) {
        await emailNotifier.sendAlertEmail({ toAddresses: alertEmails, event });
      } else {
        console.log("[alerta] e-mail NÃO enviado - SMTP ainda não configurado");
      }
    };
  }

  // TODO: números/e-mails de alerta e limiares por usuário ainda vêm de
  // env vars compartilhadas (DEMO_ALERT_NUMBERS/DEMO_ALERT_EMAILS) - cadastro
  // real desses destinatários por usuário é o próximo passo depois do
  // cadastro em si (ver docs/UI-SPEC.md, item fora do escopo desta etapa).
  const sharedAlertPhoneNumbers = (process.env.DEMO_ALERT_NUMBERS ?? "").split(",").filter(Boolean);
  const sharedAlertEmails = (process.env.DEMO_ALERT_EMAILS ?? "").split(",").filter(Boolean);

  const allAccounts = await monitoredAccounts.listAll();
  console.log(`[boot] ${allAccounts.length} conta(s) monitorada(s) encontrada(s) no banco.`);

  const monitors = allAccounts.map((account) => startMonitorForAccount(account, thresholdsRepo, makeDispatcher(account.userId, sharedAlertPhoneNumbers, sharedAlertEmails)));

  startWebhookServer(pinStore, (alertId, result) => {
    alertLog.updatePinStatus(alertId, result).catch((err) => console.error("[webhook] falha ao gravar pin_status:", err));
    console.log(`[webhook] alertId=${alertId} resultado do PIN: ${result}`);
  });

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

  startDashboard({
    users: dashboardUsers,
    accounts: accountsDetailsRepo,
    monitoredAccounts,
    thresholds: thresholdsRepo,
    alertHistory: alertLog,
    signup: signupService,
  });

  await Promise.all(monitors.map((m) => m.run));
}

function startMonitorForAccount(
  account: MonitoredAccountRow,
  thresholdsRepo: PostgresThresholdsRepository,
  dispatchAlert: (event: DetectionEvent) => Promise<void>,
) {
  const chain = getKnownChain(account.chainKey);
  const rpcUrl = resolveRpcUrl(account.chainKey, undefined);
  const thresholdsPromise = thresholdsRepo.get(account.userId);

  const run = (async () => {
    const thresholds =
      (await thresholdsPromise) ?? {
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
      await monitor.start();
      return;
    }

    const adapter = new EvmAdapter({ rpcUrl, chainId: chain.chainId, minConfirmations: 3, tokenAddress: account.tokenAddress as Address });
    const monitor = new Monitor(adapter, { address: account.watchedAddress as Address, thresholds, pollIntervalMs: 15_000 }, dispatchAlert);
    console.log(`[monitor] ativo: usuário=${account.userId} chain=${account.chainKey} token=${account.tokenAddress}`);
    await monitor.start();
  })();

  return { run };
}

function startDashboard(deps: DashboardServerDeps) {
  const dashboardServer = createDashboardServer(deps);
  const webhookPort = Number(process.env.PORT ?? 3000);
  const dashboardPort = Number(process.env.DASHBOARD_PORT ?? webhookPort + 1);
  dashboardServer.listen(dashboardPort, () => console.log(`[painel] escutando na porta ${dashboardPort}`));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
