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
import { randomBytes } from "node:crypto";
import type { Address } from "viem";
import { verifyPassword } from "./password.js";
import { verifyTotp } from "./totp.js";
import { RateLimiter } from "./rate-limiter.js";
import { SessionStore } from "./session.js";
import { buildExpiredSessionCookie, buildSessionCookie, parseCookies } from "./cookies.js";
import {
  accountsPage,
  alertsHistoryPage,
  dashboardPage,
  loginPage,
  signupPage,
  signupSuccessPage,
  thresholdsPage,
} from "./views.js";
import { getKnownChain, KNOWN_CHAINS } from "../engine/chains/known-chains.js";
import type { UserThresholds } from "../engine/rules/detection-rules.js";
import type { SignupInput, SignupResult } from "../privacy/signup-service.js";

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

export interface ThresholdsPort {
  get(userId: string): Promise<UserThresholds | null>;
  upsert(thresholds: UserThresholds): Promise<void>;
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
  const sessions = new SessionStore();

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await route(req, res, deps, loginLimiter, sessions);
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
  sessions: SessionStore,
): Promise<void> {
  const url = req.url ?? "";
  const deleteMatch = url.match(/^\/accounts\/([^/]+)\/delete$/);

  // --- API JSON original - inalterada ---
  if (req.method === "POST" && url === "/login") return handleJsonLogin(req, res, deps.users, loginLimiter, sessions);
  if (req.method === "GET" && url === "/details") return handleJsonDetails(req, res, deps.accounts, sessions);

  // --- Páginas HTML ---
  if (req.method === "GET" && url === "/") {
    // Raiz do domínio público (ex: alguém abre o link puro, sem caminho) -
    // sem isso, caía no 404 genérico, confuso pra quem não sabe que rota pedir.
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies["viligion_session"];
    const session = token ? sessions.validate(token) : null;
    return redirect(res, session ? "/dashboard" : "/login");
  }
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
  if (req.method === "GET" && url === "/thresholds") return withSession(req, res, sessions, (userId) => renderThresholds(res, deps, userId));
  if (req.method === "POST" && url === "/thresholds") return withSession(req, res, sessions, (userId) => handleUpdateThresholds(req, res, deps, userId));
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

// --- Cadastro ---

function renderSignupPage(res: ServerResponse): void {
  const nonce = randomBytes(16).toString("hex");
  send(res, 200, signupPage({ nonce }));
}

async function handleSignup(req: IncomingMessage, res: ServerResponse, signup: SignupPort): Promise<void> {
  const body = await readFormBody(req);
  const { address, nonce, signature, virtualPhoneNumber, username, password } = body;

  if (!address || !nonce || !signature || !virtualPhoneNumber || !username || !password) {
    return send(res, 400, signupPage({ nonce: nonce ?? randomBytes(16).toString("hex"), error: "Preencha todos os campos e assine com a carteira." }));
  }

  try {
    const result = await signup.signup({
      address: address as Address,
      nonce,
      signature: signature as `0x${string}`,
      virtualPhoneNumber,
      username,
      password,
    });
    send(res, 200, signupSuccessPage({ username: result.username, otpAuthUri: result.otpAuthUri }));
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

  await deps.monitoredAccounts.add({ userId, chainKey, tokenAddress, watchedAddress });
  redirect(res, "/accounts");
}

async function handleDeleteAccount(res: ServerResponse, deps: DashboardServerDeps, userId: string, accountId: string): Promise<void> {
  await deps.monitoredAccounts.remove(accountId, userId);
  redirect(res, "/accounts");
}

// --- Limiares ---

async function renderThresholds(res: ServerResponse, deps: DashboardServerDeps, userId: string, error?: string): Promise<void> {
  const current = await deps.thresholds.get(userId);
  if (!current) {
    return send(res, 404, loginPage({ error: "Limiares ainda não configurados pro seu usuário." }));
  }
  send(
    res,
    200,
    thresholdsPage({
      maxBalanceDropPct: current.maxBalanceDropPct,
      criticalBalanceDropPct: current.criticalBalanceDropPct,
      windowMinutes: current.windowMinutes,
      blockedTransferAlertThreshold: current.blockedTransferAlertThreshold.toString(),
      criticalBlockedTransferThreshold: current.criticalBlockedTransferThreshold.toString(),
      error,
    }),
  );
}

async function handleUpdateThresholds(req: IncomingMessage, res: ServerResponse, deps: DashboardServerDeps, userId: string): Promise<void> {
  const body = await readFormBody(req);
  const parsed = parseThresholdsForm(userId, body);
  if (!parsed) return renderThresholds(res, deps, userId, "Valores inválidos - confira os números informados.");

  await deps.thresholds.upsert(parsed);
  redirect(res, "/thresholds");
}

function parseThresholdsForm(userId: string, body: Record<string, string>): UserThresholds | null {
  try {
    const maxBalanceDropPct = Number(body.maxBalanceDropPct);
    const criticalBalanceDropPct = Number(body.criticalBalanceDropPct);
    const windowMinutes = Number(body.windowMinutes);
    const blockedTransferAlertThreshold = BigInt(body.blockedTransferAlertThreshold ?? "");
    const criticalBlockedTransferThreshold = BigInt(body.criticalBlockedTransferThreshold ?? "");

    if ([maxBalanceDropPct, criticalBalanceDropPct, windowMinutes].some((n) => Number.isNaN(n))) return null;

    return {
      userId,
      maxBalanceDropPct,
      criticalBalanceDropPct,
      windowMinutes,
      blockedTransferAlertThreshold,
      criticalBlockedTransferThreshold,
    };
  } catch {
    return null; // BigInt() lança se a string não for inteiro válido
  }
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
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const params = new URLSearchParams(data);
      resolve(Object.fromEntries(params));
    });
    req.on("error", reject);
  });
}
