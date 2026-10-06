/**
 * Servidor do painel. Único lugar do sistema onde saldo/endereço completo é
 * exibido - em paridade de proteção com a camada de voz (senha + TOTP +
 * rate limiting), não um login simples que vira o alvo óbvio de um
 * atacante racional.
 *
 * Duas superfícies: a API JSON original (POST /login, GET /details, Bearer
 * token) continua exatamente como era - e as páginas HTML novas (ver
 * docs/UI-SPEC.md), que usam cookie de sessão HttpOnly em vez de Bearer,
 * porque formulário HTML não manda header Authorization.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import { verifyPassword } from "./password.js";
import { verifyTotp } from "./totp.js";
import { renderOtpQrSvg } from "./otp-qr.js";
import { RateLimiter } from "./rate-limiter.js";
import { isValidEmail, isValidPhone } from "./recipient-validation.js";
import { SessionStore } from "./session.js";
import { buildExpiredSessionCookie, buildSessionCookie, parseCookies } from "./cookies.js";
import {
  accountsPage,
  alertsHistoryPage,
  dashboardPage,
  landingPage,
  loginPage,
  recipientsPage,
  signupPage,
  signupSuccessPage,
  thresholdsPage,
  type ThresholdsFormValues,
} from "./views.js";
import { getKnownChain, KNOWN_CHAINS } from "../engine/chains/known-chains.js";
import type { UserThresholds } from "../engine/rules/detection-rules.js";
import { validateThresholds } from "../engine/rules/threshold-validation.js";
import { parseUsdToUnits, unitsToUsdString } from "../engine/rules/token-units.js";
import type { SignupInput, SignupResult } from "../privacy/signup-service.js";
import { isWaitlistProfile, type WaitlistPort } from "./waitlist.js";

export interface DashboardUser {
  userId: string;
  passwordHash: string;
  totpSecret: string;
}

export interface UserRepository {
  findByUsername(username: string): Promise<DashboardUser | null>;
}

/** Dado real (saldo, endereço) - só retornado depois de sessão válida. */
export interface AccountDetails {
  address: string;
  balanceRaw: string;
  lastAlerts: Array<{ kind: string; createdAt: string }>;
}

export interface AccountDetailsRepository {
  getDetails(userId: string): Promise<AccountDetails>;
}

export interface MonitoredAccountsPort {
  listForUser(userId: string): Promise<Array<{ id: string; chainKey: string; tokenAddress: string; watchedAddress: string }>>;
  add(input: { userId: string; chainKey: string; tokenAddress: string; watchedAddress: string }): Promise<string>;
  remove(id: string, userId: string): Promise<boolean>;
}

/**
 * Sobe/para o Monitor de uma conta em tempo real, sem precisar reiniciar o
 * processo - fecha o gap documentado em docs/DEPLOYMENT.md ("o monitor só lê
 * contas novas no boot"), achado em auditoria de capacidade de 2026-10-04:
 * sem isto, uma conta cadastrada por um usuário novo nunca era monitorada de
 * verdade até alguém reiniciar o deploy manualmente. No modo demo (sem
 * Postgres), onde a lista de contas nunca foi conectada a monitores de
 * verdade (sempre foi um único endereço fixo via env var), a implementação é
 * um no-op documentado - ver index.ts#mainDemo.
 */
export interface MonitorControlPort {
  start(account: { id: string; userId: string; chainKey: string; tokenAddress: string; watchedAddress: string }): Promise<void>;
  stop(accountId: string): Promise<void>;
}

export interface ThresholdsPort {
  get(userId: string): Promise<UserThresholds | null>;
  upsert(thresholds: UserThresholds): Promise<void>;
}

export type RecipientKind = "phone" | "email";

/** Destinatários de alerta cadastrados pelo usuário - substitui as env vars compartilhadas DEMO_ALERT_NUMBERS/DEMO_ALERT_EMAILS (ver index.ts). */
export interface RecipientsPort {
  listForUser(userId: string): Promise<Array<{ id: string; kind: RecipientKind; value: string }>>;
  add(input: { userId: string; kind: RecipientKind; value: string }): Promise<string>;
  remove(id: string, userId: string): Promise<boolean>;
}

export interface AlertHistoryPort {
  detailedForUser(
    userId: string,
    limit?: number,
  ): Promise<Array<{ kind: string; severity: string; deliveredVia: string; pinStatus: string | null; createdAt: Date }>>;
}

export interface SignupPort {
  signup(input: SignupInput): Promise<SignupResult>;
}

export interface DashboardServerDeps {
  users: UserRepository;
  accounts: AccountDetailsRepository;
  monitoredAccounts: MonitoredAccountsPort;
  thresholds: ThresholdsPort;
  alertHistory: AlertHistoryPort;
  signup: SignupPort;
  recipients: RecipientsPort;
  monitorControl: MonitorControlPort;
  /** Dispara um alerta crítico sintético pro usuário (ligação + PIN) - botão de teste em /recipients. */
  testAlert?: (userId: string) => Promise<void>;
  /** Lista de espera da landing pública (/ e /waitlist). Sem isto a raiz volta a redirecionar pro login. */
  waitlist?: WaitlistPort;
}

const SESSION_COOKIE_TTL_SECONDS = 30 * 60;

/**
 * Cria o handler de requisição (sem subir servidor) - usado tanto pelo
 * servidor standalone abaixo quanto pelo servidor combinado em index.ts, que
 * junta painel + webhook da Twilio numa porta/domínio público só (ver nota
 * em webhook-server.ts#handleWebhookRequest sobre por quê: hospedagem
 * gratuita costuma liberar só um domínio público por serviço).
 */
export function createDashboardRequestHandler(deps: DashboardServerDeps) {
  const loginLimiter = new RateLimiter(5, 15 * 60_000); // 5 tentativas / 15 min por identificador
  const waitlistLimiter = new RateLimiter(5, 60 * 60_000); // 5 inscrições / hora por IP
  const sessions = new SessionStore();

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await route(req, res, deps, loginLimiter, waitlistLimiter, sessions);
    } catch (err) {
      console.error("[painel] erro não tratado:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Erro interno.");
      }
    }
  };
}

/** Servidor standalone, só painel - usado quando não há servidor combinado (ex: o smoke test manual). */
export function createDashboardServer(deps: DashboardServerDeps) {
  return createServer(createDashboardRequestHandler(deps));
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DashboardServerDeps,
  loginLimiter: RateLimiter,
  waitlistLimiter: RateLimiter,
  sessions: SessionStore,
): Promise<void> {
  const url = req.url ?? "";
  const path = url.split("?")[0];
  const deleteMatch = url.match(/^\/accounts\/([^/]+)\/delete$/);
  const recipientDeleteMatch = url.match(/^\/recipients\/([^/]+)\/delete$/);

  // --- API JSON original - inalterada ---
  if (req.method === "POST" && url === "/login") return handleJsonLogin(req, res, deps.users, loginLimiter, sessions);
  if (req.method === "GET" && url === "/details") return handleJsonDetails(req, res, deps.accounts, sessions);

  // --- Páginas HTML ---
  if (req.method === "GET" && path === "/") {
    // Raiz do domínio público: logado vai pro painel; visitante vê a landing
    // com a lista de espera (ou, sem waitlist configurada, cai no login).
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies["viligion_session"];
    const session = token ? sessions.validate(token) : null;
    if (session) return redirect(res, "/dashboard");
    if (!deps.waitlist) return redirect(res, "/login");
    return send(res, 200, landingPage({ joined: url.includes("ok=1"), baseUrl: publicBaseUrl() }));
  }
  if (req.method === "GET" && path === "/og-image.png") return serveOgImage(res);
  if (req.method === "POST" && path === "/waitlist") return handleWaitlistSignup(req, res, deps, waitlistLimiter);
  if (req.method === "GET" && path === "/admin/waitlist") return handleWaitlistExport(req, res, deps);
  if (req.method === "GET" && url === "/signup") return renderSignupPage(res);
  if (req.method === "POST" && url === "/signup") return handleSignup(req, res, deps.signup);
  if (req.method === "GET" && url === "/login") return send(res, 200, loginPage({}));
  if (req.method === "POST" && url === "/session") return handleSessionLogin(req, res, deps.users, loginLimiter, sessions);
  if (req.method === "GET" && url === "/logout") return handleLogout(req, res, sessions);

  if (req.method === "GET" && url === "/dashboard") return withSession(req, res, sessions, (userId) => renderDashboard(res, deps, userId));
  if (req.method === "GET" && url === "/accounts") return withSession(req, res, sessions, (userId) => renderAccounts(res, deps, userId));
  if (req.method === "POST" && url === "/accounts") return withSession(req, res, sessions, (userId) => handleAddAccount(req, res, deps, userId));
  if (req.method === "POST" && deleteMatch) {
    const accountId = deleteMatch[1] as string;
    return withSession(req, res, sessions, (userId) => handleDeleteAccount(res, deps, userId, accountId));
  }
  if (req.method === "GET" && path === "/thresholds") return withSession(req, res, sessions, (userId) => renderThresholds(res, deps, userId, { justSaved: url.includes("salvo=1") }));
  if (req.method === "POST" && url === "/thresholds") return withSession(req, res, sessions, (userId) => handleUpdateThresholds(req, res, deps, userId));
  if (req.method === "GET" && url === "/recipients") return withSession(req, res, sessions, (userId) => renderRecipients(res, deps, userId));
  if (req.method === "POST" && url === "/recipients") return withSession(req, res, sessions, (userId) => handleAddRecipient(req, res, deps, userId));
  if (req.method === "POST" && url === "/recipients/test") return withSession(req, res, sessions, (userId) => handleTestAlert(res, deps, userId));
  if (req.method === "POST" && recipientDeleteMatch) {
    const recipientId = recipientDeleteMatch[1] as string;
    return withSession(req, res, sessions, (userId) => handleDeleteRecipient(res, deps, userId, recipientId));
  }
  if (req.method === "GET" && url === "/alerts") return withSession(req, res, sessions, (userId) => renderAlerts(res, deps, userId));

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Não encontrado.");
}

/** Lê a sessão do cookie; redireciona pro login se ausente/expirada. Evita repetir essa checagem em cada rota protegida. */
async function withSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionStore,
  handler: (userId: string) => Promise<void>,
): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["viligion_session"];
  const session = token ? sessions.validate(token) : null;

  if (!session) {
    res.writeHead(302, { Location: "/login" });
    res.end();
    return;
  }
  await handler(session.userId);
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, extraHeaders?: Record<string, string>): void {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

// --- Lista de espera ---

/** URL pública absoluta usada nas metatags de compartilhamento. Defina PUBLIC_BASE_URL ao trocar de domínio. */
function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? "https://viligion-app-production.up.railway.app").replace(/\/+$/, "");
}

const OG_IMAGE_PATH = fileURLToPath(new URL("../../assets/og-image.png", import.meta.url));
let ogImageCache: Buffer | null = null;

function serveOgImage(res: ServerResponse): void {
  try {
    ogImageCache ??= readFileSync(OG_IMAGE_PATH);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Não encontrado.");
    return;
  }
  res.writeHead(200, { "Content-Type": "image/png", "Content-Length": ogImageCache.length, "Cache-Control": "public, max-age=3600" });
  res.end(ogImageCache);
}

/** IP do cliente atrás do proxy do Railway: o último item de x-forwarded-for é o que a borda viu (os anteriores o cliente pode forjar). */
function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const last = raw?.split(",").pop()?.trim();
  return last || req.socket.remoteAddress || "unknown";
}

async function handleWaitlistSignup(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DashboardServerDeps,
  limiter: RateLimiter,
): Promise<void> {
  if (!deps.waitlist) return redirect(res, "/login");
  const body = await readFormBody(req);
  const email = (body.email ?? "").trim();
  const profile = body.profile ?? "";
  const note = (body.note ?? "").trim().slice(0, 500);

  if (!limiter.attempt(clientIp(req))) {
    return send(res, 429, landingPage({ baseUrl: publicBaseUrl(), error: "Muitas inscrições deste endereço. Tente novamente mais tarde." }));
  }
  if (!isValidEmail(email) || email.length > 200) {
    return send(res, 400, landingPage({ baseUrl: publicBaseUrl(), error: "Informe um e-mail válido." }));
  }
  if (!isWaitlistProfile(profile)) {
    return send(res, 400, landingPage({ baseUrl: publicBaseUrl(), error: "Escolha uma das opções do seu caso." }));
  }

  const result = await deps.waitlist.add({ email, profile, note });
  console.log(`[waitlist] inscrição ${result} (perfil=${profile})`);
  redirect(res, "/?ok=1#lista");
}

/** Exporta as inscrições em JSON. Só habilitado com WAITLIST_ADMIN_TOKEN definido; sem ele a rota responde 404. */
async function handleWaitlistExport(req: IncomingMessage, res: ServerResponse, deps: DashboardServerDeps): Promise<void> {
  const token = process.env.WAITLIST_ADMIN_TOKEN;
  if (!token || !deps.waitlist) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Não encontrado.");
    return;
  }
  const provided = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("Não autorizado.");
    return;
  }
  const entries = await deps.waitlist.list();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ total: entries.length, entries }));
}

// --- Cadastro ---

function renderSignupPage(res: ServerResponse): void {
  const nonce = randomBytes(16).toString("hex");
  send(res, 200, signupPage({ nonce }));
}

async function handleSignup(req: IncomingMessage, res: ServerResponse, signup: SignupPort): Promise<void> {
  const body = await readFormBody(req);
  const { address, nonce, signature, username, password } = body;

  if (!address || !nonce || !signature || !username || !password) {
    return send(res, 400, signupPage({ nonce: nonce ?? randomBytes(16).toString("hex"), error: "Preencha todos os campos e assine com a carteira." }));
  }

  try {
    const result = await signup.signup({
      address: address as Address,
      nonce,
      signature: signature as `0x${string}`,
      username,
      password,
    });
    const qrCodeSvg = await renderOtpQrSvg(result.otpAuthUri);
    send(res, 200, signupSuccessPage({ username: result.username, otpAuthUri: result.otpAuthUri, qrCodeSvg }));
  } catch (err) {
    send(res, 400, signupPage({ nonce, error: err instanceof Error ? err.message : "Cadastro falhou." }));
  }
}

// --- Login (sessão por cookie, pras páginas HTML) ---

async function handleSessionLogin(
  req: IncomingMessage,
  res: ServerResponse,
  users: UserRepository,
  loginLimiter: RateLimiter,
  sessions: SessionStore,
): Promise<void> {
  const body = await readFormBody(req);
  const { username, password, totpCode } = body;
  const identifier = `${req.socket.remoteAddress ?? "unknown"}:${username ?? "unknown"}`;

  if (!loginLimiter.attempt(identifier)) {
    return send(res, 429, loginPage({ error: "Muitas tentativas. Tente novamente mais tarde." }));
  }
  if (!username || !password || !totpCode) {
    return send(res, 400, loginPage({ error: "Usuário, senha e código são obrigatórios." }));
  }

  const user = await users.findByUsername(username);
  const invalid = () => send(res, 401, loginPage({ error: "Credenciais inválidas." }));

  if (!user) return invalid();
  if (!verifyPassword(password, user.passwordHash)) return invalid();
  if (!verifyTotp(user.totpSecret, totpCode)) return invalid();

  loginLimiter.reset(identifier);
  const session = sessions.create(user.userId);
  redirect(res, "/dashboard", { "Set-Cookie": buildSessionCookie(session.token, SESSION_COOKIE_TTL_SECONDS) });
}

async function handleLogout(req: IncomingMessage, res: ServerResponse, sessions: SessionStore): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["viligion_session"];
  if (token) sessions.revoke(token);
  redirect(res, "/login", { "Set-Cookie": buildExpiredSessionCookie() });
}

// --- Painel principal ---

async function renderDashboard(res: ServerResponse, deps: DashboardServerDeps, userId: string): Promise<void> {
  const [details, monitoredAccounts] = await Promise.all([
    deps.accounts.getDetails(userId),
    deps.monitoredAccounts.listForUser(userId),
  ]);
  send(
    res,
    200,
    dashboardPage({
      address: details.address,
      balanceRaw: details.balanceRaw,
      accountsCount: monitoredAccounts.length,
      recentAlerts: details.lastAlerts,
    }),
  );
}

// --- Contas monitoradas ---

async function renderAccounts(res: ServerResponse, deps: DashboardServerDeps, userId: string, error?: string): Promise<void> {
  const accounts = await deps.monitoredAccounts.listForUser(userId);
  send(res, 200, accountsPage({ accounts, knownChainKeys: Object.keys(KNOWN_CHAINS), error }));
}

async function handleAddAccount(req: IncomingMessage, res: ServerResponse, deps: DashboardServerDeps, userId: string): Promise<void> {
  const body = await readFormBody(req);
  const { chainKey, tokenAddress, watchedAddress } = body;

  if (!chainKey || !tokenAddress || !watchedAddress) {
    return renderAccounts(res, deps, userId, "Preencha chain, token e endereço monitorado.");
  }
  try {
    getKnownChain(chainKey); // valida a chave ANTES de gravar - nunca aceita chain desconhecida
  } catch {
    return renderAccounts(res, deps, userId, `Chain desconhecida: "${chainKey}".`);
  }

  const id = await deps.monitoredAccounts.add({ userId, chainKey, tokenAddress, watchedAddress });
  // Sobe o monitor AGORA, sem esperar um restart do processo (achado de
  // capacidade de 2026-10-04 - ver nota em MonitorControlPort).
  await deps.monitorControl.start({ id, userId, chainKey, tokenAddress, watchedAddress });
  redirect(res, "/accounts");
}

async function handleDeleteAccount(res: ServerResponse, deps: DashboardServerDeps, userId: string, accountId: string): Promise<void> {
  const removed = await deps.monitoredAccounts.remove(accountId, userId);
  if (removed) await deps.monitorControl.stop(accountId); // só para o monitor se a conta era mesmo do usuário logado
  redirect(res, "/accounts");
}

// --- Limiares ---

function toFormValues(t: UserThresholds): ThresholdsFormValues {
  return {
    warn: t.maxBalanceDropPct,
    crit: t.criticalBalanceDropPct,
    win: t.windowMinutes,
    bw: Number(unitsToUsdString(t.blockedTransferAlertThreshold)),
    bc: Number(unitsToUsdString(t.criticalBlockedTransferThreshold)),
  };
}

/** Reaproveita o que o usuário digitou no POST que falhou; campo ilegível volta ao valor salvo. */
function submittedValues(body: Record<string, string>, saved: ThresholdsFormValues): ThresholdsFormValues {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number((raw ?? "").trim().replace(",", "."));
    return raw?.trim() && Number.isFinite(n) ? n : fallback;
  };
  return {
    warn: num(body.maxBalanceDropPct, saved.warn),
    crit: num(body.criticalBalanceDropPct, saved.crit),
    win: num(body.windowMinutes, saved.win),
    bw: num(body.blockedWarnUsd, saved.bw),
    bc: num(body.blockedCritUsd, saved.bc),
  };
}

async function currentBalanceUsd(deps: DashboardServerDeps, userId: string): Promise<number | null> {
  try {
    const raw = BigInt((await deps.accounts.getDetails(userId)).balanceRaw);
    return raw > 0n ? Number(unitsToUsdString(raw)) : null;
  } catch {
    return null;
  }
}

async function renderThresholds(
  res: ServerResponse,
  deps: DashboardServerDeps,
  userId: string,
  opts: { error?: string; status?: number; submitted?: Record<string, string>; justSaved?: boolean } = {},
): Promise<void> {
  const current = await deps.thresholds.get(userId);
  if (!current) {
    return send(res, 404, loginPage({ error: "Limiares ainda não configurados pro seu usuário." }));
  }
  const saved = toFormValues(current);
  send(
    res,
    opts.status ?? 200,
    thresholdsPage({
      current: opts.submitted ? submittedValues(opts.submitted, saved) : saved,
      saved,
      balanceUsd: await currentBalanceUsd(deps, userId),
      justSaved: opts.justSaved,
      error: opts.error,
    }),
  );
}

async function handleUpdateThresholds(req: IncomingMessage, res: ServerResponse, deps: DashboardServerDeps, userId: string): Promise<void> {
  const body = await readFormBody(req);
  const fail = (error: string) => renderThresholds(res, deps, userId, { error, status: 400, submitted: body });

  const parsed = parseThresholdsForm(userId, body);
  if (!parsed) return fail("Valores inválidos - confira os números informados (dólares com até 6 casas, ex.: 2000 ou 2000,50).");
  const problem = validateThresholds(parsed);
  if (problem) return fail(problem);

  await deps.thresholds.upsert(parsed);
  redirect(res, "/thresholds?salvo=1");
}

function parseThresholdsForm(userId: string, body: Record<string, string>): UserThresholds | null {
  const required = [body.maxBalanceDropPct, body.criticalBalanceDropPct, body.windowMinutes];
  if (required.some((v) => !v?.trim())) return null;

  const maxBalanceDropPct = Number(body.maxBalanceDropPct);
  const criticalBalanceDropPct = Number(body.criticalBalanceDropPct);
  const windowMinutes = Number(body.windowMinutes);
  const blockedTransferAlertThreshold = parseUsdToUnits(body.blockedWarnUsd);
  const criticalBlockedTransferThreshold = parseUsdToUnits(body.blockedCritUsd);

  if ([maxBalanceDropPct, criticalBalanceDropPct, windowMinutes].some((n) => !Number.isFinite(n))) return null;
  if (blockedTransferAlertThreshold === null || criticalBlockedTransferThreshold === null) return null;

  return {
    userId,
    maxBalanceDropPct,
    criticalBalanceDropPct,
    windowMinutes,
    blockedTransferAlertThreshold,
    criticalBlockedTransferThreshold,
  };
}

// --- Destinatários de alerta ---

async function renderRecipients(
  res: ServerResponse,
  deps: DashboardServerDeps,
  userId: string,
  error?: string,
  notice?: string,
): Promise<void> {
  const recipients = await deps.recipients.listForUser(userId);
  send(res, 200, recipientsPage({ recipients, error, notice, canTest: Boolean(deps.testAlert) }));
}

const TEST_ALERT_COOLDOWN_MS = 60_000; // ligação custa dinheiro e incomoda - evita spam acidental ou abusivo
const lastTestAlertAt = new Map<string, number>();

async function handleTestAlert(res: ServerResponse, deps: DashboardServerDeps, userId: string): Promise<void> {
  if (!deps.testAlert) return renderRecipients(res, deps, userId, "Alerta de teste indisponível neste ambiente.");
  const last = lastTestAlertAt.get(userId) ?? 0;
  if (Date.now() - last < TEST_ALERT_COOLDOWN_MS) {
    return renderRecipients(res, deps, userId, "Aguarde 1 minuto entre alertas de teste.");
  }
  const recipients = await deps.recipients.listForUser(userId);
  if (!recipients.some((r) => r.kind === "phone")) {
    return renderRecipients(res, deps, userId, "Cadastre pelo menos um telefone antes de testar.");
  }
  lastTestAlertAt.set(userId, Date.now());
  await deps.testAlert(userId);
  return renderRecipients(res, deps, userId, undefined, "Alerta de teste disparado: a ligação deve tocar em instantes e o código chega por WhatsApp.");
}

async function handleAddRecipient(req: IncomingMessage, res: ServerResponse, deps: DashboardServerDeps, userId: string): Promise<void> {
  const body = await readFormBody(req);
  const { kind, value } = body;

  if (kind !== "phone" && kind !== "email") {
    return renderRecipients(res, deps, userId, "Tipo de destinatário inválido.");
  }
  if (!value) {
    return renderRecipients(res, deps, userId, "Informe o número de telefone ou e-mail.");
  }
  // Pega erro de digitação agora, não só quando o Twilio/SMTP rejeitar na
  // hora de um alerta real (achado de auditoria de 2026-10-04).
  if (kind === "phone" && !isValidPhone(value)) {
    return renderRecipients(res, deps, userId, "Telefone inválido - use o formato internacional, ex: +5511999999999.");
  }
  if (kind === "email" && !isValidEmail(value)) {
    return renderRecipients(res, deps, userId, "E-mail inválido.");
  }

  await deps.recipients.add({ userId, kind, value: value.trim() });
  redirect(res, "/recipients");
}

async function handleDeleteRecipient(res: ServerResponse, deps: DashboardServerDeps, userId: string, recipientId: string): Promise<void> {
  await deps.recipients.remove(recipientId, userId);
  redirect(res, "/recipients");
}

// --- Histórico de alertas ---

async function renderAlerts(res: ServerResponse, deps: DashboardServerDeps, userId: string): Promise<void> {
  const entries = await deps.alertHistory.detailedForUser(userId);
  send(
    res,
    200,
    alertsHistoryPage({
      alerts: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    }),
  );
}

// --- API JSON original (inalterada) ---

async function handleJsonLogin(
  req: IncomingMessage,
  res: ServerResponse,
  users: UserRepository,
  loginLimiter: RateLimiter,
  sessions: SessionStore,
): Promise<void> {
  const body = await readJsonBody(req);
  const { username, password, totpCode } = body as {
    username?: string;
    password?: string;
    totpCode?: string;
  };

  const identifier = `${req.socket.remoteAddress ?? "unknown"}:${username ?? "unknown"}`;

  if (!loginLimiter.attempt(identifier)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Muitas tentativas. Tente novamente mais tarde." }));
    return;
  }

  if (!username || !password || !totpCode) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "username, password e totpCode são obrigatórios" }));
    return;
  }

  const user = await users.findByUsername(username);

  const invalidCredentialsResponse = () => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Credenciais inválidas." }));
  };

  if (!user) return invalidCredentialsResponse();
  if (!verifyPassword(password, user.passwordHash)) return invalidCredentialsResponse();
  if (!verifyTotp(user.totpSecret, totpCode)) return invalidCredentialsResponse();

  loginLimiter.reset(identifier);
  const session = sessions.create(user.userId);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ token: session.token, expiresAt: session.expiresAt }));
}

async function handleJsonDetails(
  req: IncomingMessage,
  res: ServerResponse,
  accounts: AccountDetailsRepository,
  sessions: SessionStore,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  const session = token ? sessions.validate(token) : null;
  if (!session) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Sessão inválida ou expirada." }));
    return;
  }

  const details = await accounts.getDetails(session.userId);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(details));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** application/x-www-form-urlencoded - formato padrão de <form method="POST">. */
function readFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        req.destroy();
        reject(new Error("corpo da requisição grande demais"));
      }
    });
    req.on("end", () => {
      const params = new URLSearchParams(data);
      resolve(Object.fromEntries(params));
    });
    req.on("error", reject);
  });
}
