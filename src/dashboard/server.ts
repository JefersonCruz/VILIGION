/**
 * Servidor do painel. Único lugar do sistema onde saldo/endereço completo é
 * exibido - em paridade de proteção com a camada de voz (senha + TOTP +
 * rate limiting), não um login simples que vira o alvo óbvio de um
 * atacante racional.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyPassword } from "./password.js";
import { verifyTotp } from "./totp.js";
import { RateLimiter } from "./rate-limiter.js";
import { SessionStore } from "./session.js";

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

export function createDashboardServer(
  users: UserRepository,
  accounts: AccountDetailsRepository,
) {
  const loginLimiter = new RateLimiter(5, 15 * 60_000); // 5 tentativas / 15 min por identificador
  const sessions = new SessionStore();

  return createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/login") {
      await handleLogin(req, res, users, loginLimiter, sessions);
      return;
    }

    if (req.method === "GET" && req.url === "/details") {
      await handleDetails(req, res, accounts, sessions);
      return;
    }

    res.writeHead(404);
    res.end();
  });
}

async function handleLogin(
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

  // Mesma resposta genérica pra usuário inexistente ou senha errada - não
  // revelar qual dos dois falhou (evita enumeração de usuários válidos).
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

async function handleDetails(
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
