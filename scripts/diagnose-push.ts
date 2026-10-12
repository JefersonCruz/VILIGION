/**
 * Diagnostico do canal de push: tenta entregar de verdade e imprime o erro
 * COMPLETO, com codigo de status e corpo da resposta do push service.
 *
 * Existe porque o log de producao so guarda `err.message`, e a mensagem da
 * biblioteca ("Received unexpected response code") nao diz nada sobre a causa.
 * O que distingue "inscricao expirada" (410) de "chave VAPID nao confere"
 * (403) de "payload grande demais" (413) e o statusCode, nao a mensagem.
 *
 * Rode dentro do container:
 *   railway ssh --service viligion-app
 *   cd /app && npx tsx scripts/diagnose-push.ts
 *
 * NAO imprime o endpoint inteiro - so o host. O endpoint e uma capacidade:
 * quem o tem, notifica o aparelho.
 */

import "dotenv/config";
import { Pool } from "pg";
import webpush from "web-push";
import { MappingEncryption, LocalDevKeyProvider } from "../src/privacy/encryption.js";
import { parsePushSubscription } from "../src/dashboard/push-subscription.js";

const databaseUrl = process.env.DATABASE_URL;
const masterKey = process.env.ENCRYPTION_KEY_KMS_ARN;
const pub = process.env.VAPID_PUBLIC_KEY;
const priv = process.env.VAPID_PRIVATE_KEY;
const sub = process.env.VAPID_SUBJECT;

for (const [nome, valor] of [["DATABASE_URL", databaseUrl], ["ENCRYPTION_KEY_KMS_ARN", masterKey], ["VAPID_PUBLIC_KEY", pub], ["VAPID_PRIVATE_KEY", priv], ["VAPID_SUBJECT", sub]] as const) {
  if (!valor) {
    console.error(`${nome} ausente.`);
    process.exit(1);
  }
}

console.log("VAPID_SUBJECT  :", sub);
console.log("chave publica  :", pub!.slice(0, 12) + "… (" + pub!.length + " chars)");

const pool = new Pool({ connectionString: databaseUrl });
const encryption = new MappingEncryption(new LocalDevKeyProvider(masterKey!));

try {
  const { rows } = await pool.query<{
    id: string;
    encrypted_data_key: Buffer;
    iv: Buffer;
    auth_tag: Buffer;
    ciphertext: Buffer;
  }>(`SELECT id, encrypted_data_key, iv, auth_tag, ciphertext FROM alert_recipients WHERE kind = 'push'`);

  console.log(`\n${rows.length} dispositivo(s) registrado(s).\n`);
  if (!rows.length) {
    console.log("Nenhum dispositivo. Registre em /recipients antes de diagnosticar.");
    process.exit(0);
  }

  webpush.setVapidDetails(sub!, pub!, priv!);

  for (const row of rows) {
    const raw = await encryption.decrypt({
      encryptedDataKey: row.encrypted_data_key,
      iv: row.iv,
      authTag: row.auth_tag,
      ciphertext: row.ciphertext,
    });
    const parsed = parsePushSubscription(raw);
    if (!parsed) {
      console.log(`[${row.id}] inscricao ilegivel no banco - formato inesperado.`);
      continue;
    }

    const host = new URL(parsed.endpoint).hostname;
    console.log(`[${row.id}] push service: ${host}`);

    try {
      const res = await webpush.sendNotification(
        parsed,
        JSON.stringify({ title: "VILIGION", body: "Diagnostico de canal.", url: "https://viligion.com/dashboard" }),
        { TTL: 60, urgency: "high" },
      );
      console.log(`  ENTREGUE. status=${(res as { statusCode?: number }).statusCode}`);
    } catch (err) {
      const e = err as { statusCode?: number; body?: string; headers?: unknown; message?: string };
      console.log(`  FALHOU.`);
      console.log(`    statusCode : ${e.statusCode ?? "(nenhum)"}`);
      console.log(`    body       : ${(e.body ?? "").toString().slice(0, 400) || "(vazio)"}`);
      console.log(`    message    : ${e.message ?? ""}`);
      if (e.statusCode === 410 || e.statusCode === 404) {
        console.log("    => inscricao morta. O aparelho precisa se registrar de novo em /recipients.");
      }
      if (e.statusCode === 403) {
        console.log("    => chave VAPID nao confere com a que o aparelho usou ao se inscrever.");
        console.log("       Trocar o PAR de chaves invalida toda inscricao existente.");
      }
      if (e.statusCode === 400) {
        console.log("    => requisicao rejeitada. Causa comum: VAPID_SUBJECT em formato que o push service recusa.");
      }
    }
  }
} finally {
  await pool.end();
}
