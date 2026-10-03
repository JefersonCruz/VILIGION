/**
 * Aplica privacy/mapping-schema.sql contra DATABASE_URL. Idempotente via
 * `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` - seguro
 * rodar de novo. Rode com: npx tsx scripts/migrate.ts
 *
 * Sem framework de migration de propósito (Drizzle/Prisma/Knex) - escopo de
 * hackathon tem um schema só, versionado no próprio arquivo .sql; adicionar
 * uma ferramenta de migration incremental agora seria complexidade sem
 * benefício no estágio atual.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrate] DATABASE_URL não configurado - nada a fazer.");
    process.exit(1);
  }

  const schemaPath = join(__dirname, "..", "src", "privacy", "mapping-schema.sql");
  const schemaSql = readFileSync(schemaPath, "utf8")
    .replace(/CREATE TABLE /g, "CREATE TABLE IF NOT EXISTS ")
    .replace(/CREATE INDEX /g, "CREATE INDEX IF NOT EXISTS ");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    console.log("[migrate] aplicando privacy/mapping-schema.sql...");
    await pool.query(schemaSql);
    console.log("[migrate] OK - tabelas: phone_mappings, user_thresholds, monitored_accounts, alert_log");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] falhou:", err);
  process.exit(1);
});
