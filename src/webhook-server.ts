/**
 * Servidor HTTP mínimo (sem framework) que recebe a resposta do <Gather> da
 * Twilio. Toda requisição passa por assertValidTwilioWebhook ANTES de
 * qualquer lógica de negócio - é o item que, se pulado sob pressão de
 * prazo, transforma o PIN inteiro em teatro (ver twilio-webhook-validator.ts).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { assertValidTwilioWebhook } from "./alerts/twilio-webhook-validator.js";
import { checkPin, type PendingPin } from "./alerts/pin.js";
import { getPendingTwiml } from "./alerts/twilio-voice.js";

export interface WebhookServerConfig {
  port: number;
  authToken: string;
  /** base pública usada pra reconstruir a URL exata que a Twilio assinou (ex: https://xxxx.ngrok.io) */
  publicBaseUrl: string;
}

export type PinStore = Map<string, PendingPin>;

/**
 * Tenta tratar a requisição como webhook da Twilio. Devolve `true` se o path
 * bateu (independente do resultado - inválido ainda conta como "tratado",
 * já respondeu 4xx), `false` se não é rota de webhook - permite compor com
 * outro handler (ver dashboard/server.ts#createDashboardRequestHandler e o
 * servidor combinado em index.ts) sem duplicar porta/domínio público.
 */
export async function handleWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: WebhookServerConfig,
  pinStore: PinStore,
  onPinResult: (alertId: string, result: ReturnType<typeof checkPin>) => void,
): Promise<boolean> {
  if (req.method === "POST" && req.url?.startsWith("/webhooks/twilio/gather")) {
    await handleGather(req, res, config, pinStore, onPinResult);
    return true;
  }
  if ((req.method === "POST" || req.method === "GET") && req.url?.startsWith("/webhooks/twilio/voice")) {
    await handleVoiceTwiml(req, res, config);
    return true;
  }
  return false;
}

async function handleVoiceTwiml(req: IncomingMessage, res: ServerResponse, config: WebhookServerConfig): Promise<void> {
  const body = req.method === "POST" ? await readBody(req) : "";
  const params = Object.fromEntries(new URLSearchParams(body));
  const fullUrl = new URL(req.url ?? "", config.publicBaseUrl).toString();
  const signatureHeader = req.headers["x-twilio-signature"];

  try {
    assertValidTwilioWebhook({
      authToken: config.authToken,
      fullUrl,
      signatureHeader: Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader,
      params,
    });
  } catch (err) {
    console.error("[webhook] assinatura Twilio inválida em /voice - requisição rejeitada:", err);
    res.writeHead(403);
    res.end();
    return;
  }

  const alertId = new URL(fullUrl).searchParams.get("alertId");
  const twiml = alertId ? getPendingTwiml(alertId) : undefined;
  if (!twiml) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml);
}

/** Servidor standalone, só webhook - usado quando não há servidor combinado (ex: testes isolados). */
export function createWebhookServer(
  config: WebhookServerConfig,
  pinStore: PinStore,
  onPinResult: (alertId: string, result: ReturnType<typeof checkPin>) => void,
) {
  return createServer(async (req, res) => {
    const handled = await handleWebhookRequest(req, res, config, pinStore, onPinResult);
    if (!handled) {
      res.writeHead(404);
      res.end();
    }
  });
}

async function handleGather(
  req: IncomingMessage,
  res: ServerResponse,
  config: WebhookServerConfig,
  pinStore: PinStore,
  onPinResult: (alertId: string, result: ReturnType<typeof checkPin>) => void,
): Promise<void> {
  const body = await readBody(req);
  const params = Object.fromEntries(new URLSearchParams(body));

  const fullUrl = new URL(req.url ?? "", config.publicBaseUrl).toString();
  const signatureHeader = req.headers["x-twilio-signature"];

  try {
    assertValidTwilioWebhook({
      authToken: config.authToken,
      fullUrl,
      signatureHeader: Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader,
      params,
    });
  } catch (err) {
    console.error("[webhook] assinatura Twilio inválida - requisição rejeitada:", err);
    res.writeHead(403);
    res.end();
    return;
  }

  const alertId = new URL(fullUrl).searchParams.get("alertId");
  const submittedPin = params["Digits"];

  if (!alertId || !submittedPin) {
    res.writeHead(400);
    res.end();
    return;
  }

  const pending = pinStore.get(alertId);
  if (!pending) {
    res.writeHead(404);
    res.end();
    return;
  }

  const result = checkPin(pending, submittedPin);
  if (result === "valid") pending.consumed = true;
  if (result === "invalid") pending.attempts += 1; // só conta tentativa de verdade, não expired/already-consumed/locked
  onPinResult(alertId, result);

  const message =
    result === "valid"
      ? "Confirmado. Acesse o painel para ver os detalhes."
      : "Código inválido. Acesse o painel para ver os detalhes.";

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="pt-BR">${escapeXml(message)}</Say></Response>`,
  );
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function escapeXml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
