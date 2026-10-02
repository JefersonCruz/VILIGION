/**
 * Servidor HTTP mínimo (sem framework) que recebe a resposta do <Gather> da
 * Twilio. Toda requisição passa por assertValidTwilioWebhook ANTES de
 * qualquer lógica de negócio - é o item que, se pulado sob pressão de
 * prazo, transforma o PIN inteiro em teatro (ver twilio-webhook-validator.ts).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { assertValidTwilioWebhook } from "./alerts/twilio-webhook-validator.js";
import { checkPin, type PendingPin } from "./alerts/pin.js";

export interface WebhookServerConfig {
  port: number;
  authToken: string;
  /** base pública usada pra reconstruir a URL exata que a Twilio assinou (ex: https://xxxx.ngrok.io) */
  publicBaseUrl: string;
}

export type PinStore = Map<string, PendingPin>;

export function createWebhookServer(
  config: WebhookServerConfig,
  pinStore: PinStore,
  onPinResult: (alertId: string, result: ReturnType<typeof checkPin>) => void,
) {
  return createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.startsWith("/webhooks/twilio/gather")) {
      await handleGather(req, res, config, pinStore, onPinResult);
      return;
    }

    res.writeHead(404);
    res.end();
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
