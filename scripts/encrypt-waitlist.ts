/**
 * Cifra as inscrições que já existem em texto puro na lista de espera.
 *
 * Contexto: até 2026-10-12 `waitlist_signups` guardava `email TEXT PRIMARY
 * KEY` — contato de terceiros em claro, e ainda indexado. A tabela nova,
 * `waitlist_signups_enc`, guarda e-mail e nota sob o mesmo envelope
 * AES-256-GCM do resto do projeto. Este script move o que ficou para trás.
 *
 * Rode DENTRO do container, onde ENCRYPTION_KEY_KMS_ARN existe:
 *
 *   railway ssh --service viligion-app
 *   cd /app && npx tsx scripts/encrypt-waitlist.ts
 *
 * É idempotente: usa ON CONFLICT DO NOTHING, então rodar duas vezes não
 * duplica nada.
 *
 * NÃO apaga a tabela antiga de propósito. Apagar dado é irreversível, e quem
 * decide isso é o dono depois de conferir que a nova está completa. O comando
 * aparece no fim da saída.
 */

import "dotenv/config";
import { Pool } from "pg";
import { MappingEncryption, LocalDevKeyProvider } from "../src/privacy/encryption.js";
import { emailFingerprint, type WaitlistProfile } from "../src/dashboard/waitlist.js";

const databaseUrl = process.env.DATABASE_URL;
const pepper = process.env.ENCRYPTION_KEY_KMS_ARN;

if (!databaseUrl) {
  console.error("DATABASE_URL ausente. Rode dentro do container (railway ssh --service viligion-app).");
  process.exit(1);
}
if (!pepper) {
  console.error("ENCRYPTION_KEY_KMS_ARN ausente - sem ela não dá pra cifrar nem calcular a impressão digital.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const encryption = new MappingEncryption(new LocalDevKeyProvider(pepper));

try {
  const antiga = await pool.query<{ to_regclass: string | null }>(`SELECT to_regclass('waitlist_signups')`);
  if (!antiga.rows[0]?.to_regclass) {
    console.log("Tabela antiga não existe - nada a migrar.");
    process.exit(0);
  }

  await pool.query(
    `CREATE TABLE IF NOT EXISTS waitlist_signups_enc (
       email_hash         TEXT PRIMARY KEY,
       profile            TEXT NOT NULL,
       encrypted_data_key BYTEA NOT NULL,
       iv                 BYTEA NOT NULL,
       auth_tag           BYTEA NOT NULL,
       ciphertext         BYTEA NOT NULL,
       created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const { rows } = await pool.query<{ email: string; profile: string; note: string; created_at: Date }>(
    `SELECT email, profile, note, created_at FROM waitlist_signups ORDER BY created_at`,
  );
  console.log(`${rows.length} inscrição(ões) em texto puro na tabela antiga.`);

  let migradas = 0;
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    const payload = await encryption.encrypt(JSON.stringify({ email, note: row.note ?? "" }));
    const r = await pool.query(
      `INSERT INTO waitlist_signups_enc (email_hash, profile, encrypted_data_key, iv, auth_tag, ciphertext, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email_hash) DO NOTHING`,
      [
        emailFingerprint(email, pepper),
        row.profile as WaitlistProfile,
        payload.encryptedDataKey,
        payload.iv,
        payload.authTag,
        payload.ciphertext,
        row.created_at,
      ],
    );
    if (r.rowCount === 1) migradas++;
  }

  const total = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM waitlist_signups_enc`);
  console.log(`${migradas} migrada(s) agora. Total na tabela cifrada: ${total.rows[0]?.count}.`);

  if (Number(total.rows[0]?.count ?? 0) >= rows.length) {
    console.log("\nA tabela cifrada já contém tudo que havia na antiga.");
    console.log("Confira a lista (npm run waitlist) e, se estiver certa, apague a antiga:");
    console.log("\n  node -e \"const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query('DROP TABLE waitlist_signups');console.log('tabela antiga apagada');await c.end();})()\"\n");
  } else {
    console.log("\nATENÇÃO: a contagem não bate. NÃO apague a tabela antiga - investigue antes.");
  }
} finally {
  await pool.end();
}
