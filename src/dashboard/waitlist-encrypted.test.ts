import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { emailFingerprint, PostgresWaitlistRepository, type WaitlistEncryption } from "./waitlist.js";
import { MappingEncryption, LocalDevKeyProvider } from "../privacy/encryption.js";

/**
 * Lista de espera com e-mail cifrado em repouso.
 *
 * O teste que mais importa é o primeiro: nenhum parâmetro enviado ao banco
 * pode conter o e-mail em texto legível. Antes desta mudança, `email` era
 * `TEXT PRIMARY KEY` — contato de terceiros em claro e indexado, num produto
 * cujo SECURITY.md promete o contrário.
 *
 * Usa a MappingEncryption de verdade, não um fake: o ponto é provar que o
 * ciclo cifra-grava-lê-decifra funciona com o mesmo envelope AES-256-GCM do
 * resto do projeto.
 */
describe("lista de espera - cifrada em repouso", () => {
  const PEPPER = "pepper-de-teste-nao-precisa-ser-hex";
  /** LocalDevKeyProvider espera chave mestra em hex de 32 bytes - separada do pepper de propósito. */
  const MASTER_KEY = "a".repeat(64);
  const EMAIL = "dono@empresa.com.br";
  const NOTA = "Tenho medo de perder acesso durante uma viagem";

  /** Pool falso que grava o que foi executado, pra inspecionar os parâmetros. */
  function fakePool() {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const rows: Record<string, unknown>[] = [];
    const pool = {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        if (sql.includes("INSERT")) {
          rows.push({
            email_hash: params[0],
            profile: params[1],
            encrypted_data_key: params[2],
            iv: params[3],
            auth_tag: params[4],
            ciphertext: params[5],
            created_at: new Date(),
          });
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SELECT")) return { rows, rowCount: rows.length };
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;
    return { pool, queries, rows };
  }

  function repo(pool: Pool): PostgresWaitlistRepository {
    const encryption: WaitlistEncryption = new MappingEncryption(new LocalDevKeyProvider(MASTER_KEY));
    return new PostgresWaitlistRepository(pool, encryption, PEPPER);
  }

  it("NUNCA manda o e-mail nem a nota em texto legível para o banco", async () => {
    const { pool, queries } = fakePool();
    await repo(pool).add({ email: EMAIL, profile: "treasury", note: NOTA });

    const tudo = JSON.stringify(
      queries.map((q) => ({ sql: q.sql, params: q.params.map((p) => (Buffer.isBuffer(p) ? p.toString("utf8") : p)) })),
    );

    expect(tudo).not.toContain(EMAIL);
    expect(tudo).not.toContain("dono@");
    expect(tudo).not.toContain(NOTA);
    expect(tudo).not.toContain("viagem");
  });

  it("o perfil e a data ficam em claro de propósito - permitem estatística sem decifrar nada", async () => {
    const { pool, queries } = fakePool();
    await repo(pool).add({ email: EMAIL, profile: "treasury", note: "" });

    const insert = queries.find((q) => q.sql.includes("INSERT"));
    expect(insert?.params[1]).toBe("treasury");
  });

  it("fecha o ciclo: o que foi gravado cifrado volta legível ao listar", async () => {
    const { pool } = fakePool();
    const r = repo(pool);
    await r.add({ email: EMAIL, profile: "treasury", note: NOTA });

    const [entrada] = await r.list();

    expect(entrada?.email).toBe(EMAIL);
    expect(entrada?.note).toBe(NOTA);
    expect(entrada?.profile).toBe("treasury");
  });

  it("normaliza o e-mail antes de cifrar - maiúsculas e espaços não criam duplicata", async () => {
    const { pool } = fakePool();
    const r = repo(pool);
    await r.add({ email: "  Dono@Empresa.COM.BR  ", profile: "other", note: "" });

    expect((await r.list())[0]?.email).toBe(EMAIL);
  });

  describe("impressão digital para deduplicar", () => {
    it("é estável para o mesmo e-mail, independente de caixa e espaços", () => {
      const a = emailFingerprint("Dono@Empresa.com.BR", PEPPER);
      const b = emailFingerprint("  dono@empresa.com.br ", PEPPER);
      expect(a).toBe(b);
    });

    it("difere entre e-mails diferentes", () => {
      expect(emailFingerprint("a@x.com", PEPPER)).not.toBe(emailFingerprint("b@x.com", PEPPER));
    });

    it("depende do pepper - sem o segredo do ambiente, o hash do banco não pode ser reproduzido", () => {
      // É isto que impede que um vazamento SÓ do banco permita testar palpites
      // de e-mail contra os hashes guardados.
      expect(emailFingerprint(EMAIL, PEPPER)).not.toBe(emailFingerprint(EMAIL, "outro-pepper"));
    });

    it("não contém o e-mail - é hash, não codificação", () => {
      const fp = emailFingerprint(EMAIL, PEPPER);
      expect(fp).not.toContain("dono");
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
