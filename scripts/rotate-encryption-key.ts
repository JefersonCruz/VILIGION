/**
 * Troca a chave mestra de criptografia SEM perder dado nenhum.
 *
 *   # 1. simula, nao escreve nada
 *   npx tsx scripts/rotate-encryption-key.ts --old <hex-atual> --new <hex-nova> --dry-run
 *
 *   # 2. executa
 *   npx tsx scripts/rotate-encryption-key.ts --old <hex-atual> --new <hex-nova>
 *
 * Gere a chave nova com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * ---
 *
 * POR QUE ISTO EXISTE
 *
 * Em 22/10/2026 a Railway notificou que um terceiro pode ter lido variaveis de
 * ambiente de clientes, incluindo conteudo descriptografado. A chave mestra
 * deste projeto vive numa variavel de ambiente (`ENCRYPTION_KEY_KMS_ARN`, lida
 * por LocalDevKeyProvider) - exatamente o cenario que o SECURITY.md ja
 * descrevia como a lacuna conhecida da issue #9:
 *
 *   "A leak of the database alone still yields ciphertext, but an attacker
 *    who also reads the app's environment gets the key."
 *
 * Trocar a chave passou de boa pratica a resposta a incidente. E sem esta
 * ferramenta, trocar significava perder todo dado cifrado - o que na pratica
 * significa nao trocar.
 *
 * ---
 *
 * COMO FUNCIONA, E POR QUE E BARATO
 *
 * A cifragem e por ENVELOPE (ver privacy/encryption.ts): cada registro tem a
 * sua propria DEK, gerada na hora, e o que fica no banco e a DEK EMPACOTADA
 * pela chave mestra - junto do iv, do auth tag e do ciphertext.
 *
 * Entao rotacionar nao mexe no dado: abre a DEK com a chave VELHA, fecha com a
 * NOVA, e grava so a coluna `encrypted_data_key`. O `ciphertext` continua
 * byte a byte o mesmo, cifrado pela mesma DEK de sempre. Nada e decifrado e
 * recifrado, e nenhum texto em claro de telefone ou e-mail passa por aqui.
 *
 * O que isto NAO resolve: se a chave velha ja vazou, quem a copiou junto com
 * um dump do banco ja tem o conteudo. Rotacionar fecha a porta pra frente,
 * nao apaga o que ja saiu. Ver a secao de incidente no SECURITY.md.
 */

import { Client } from "pg";
import { LocalDevKeyProvider, MappingEncryption } from "../src/privacy/encryption.js";

/** Toda tabela que guarda um envelope. Se alguem adicionar outra, tem que entrar aqui. */
const TABELAS = [
  { nome: "phone_mappings", pk: "id" },
  { nome: "alert_recipients", pk: "id" },
  { nome: "waitlist_signups_enc", pk: "id" },
] as const;

interface Args {
  old: string;
  nova: string;
  dryRun: boolean;
  databaseUrl: string;
}

function parseArgs(argv: string[]): Args {
  const get = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const old = get("old");
  const nova = get("new");
  const databaseUrl = get("database-url") ?? process.env.DATABASE_URL;

  const erro = (m: string): never => {
    console.error(m);
    console.error("\nUso: npx tsx scripts/rotate-encryption-key.ts --old <hex> --new <hex> [--dry-run]");
    console.error("Gere a nova: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
    process.exit(2);
  };

  if (!old || !nova) erro("Faltou --old ou --new.");
  if (!databaseUrl) erro("Sem DATABASE_URL. Rode via `railway run --service viligion-app -- ...` ou passe --database-url.");
  // 32 bytes = 64 hex. Conferir aqui evita descobrir no meio da rotacao.
  for (const [nome, v] of [["--old", old], ["--new", nova]] as const) {
    if (!/^[0-9a-fA-F]{64}$/.test(v)) erro(`${nome} precisa ser 64 caracteres hex (32 bytes). Recebi ${v.length}.`);
  }
  if (old === nova) erro("--old e --new sao iguais. Isso nao rotaciona nada.");

  return { old, nova, dryRun: argv.includes("--dry-run"), databaseUrl };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const velha = new MappingEncryption(new LocalDevKeyProvider(args.old));
  const novaProvider = new LocalDevKeyProvider(args.nova);

  const client = new Client({ connectionString: args.databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log(args.dryRun ? "MODO SIMULACAO - nada sera escrito\n" : "ROTACIONANDO DE VERDADE\n");

  let total = 0;
  let falhas = 0;

  for (const tabela of TABELAS) {
    let linhas: Array<Record<string, Buffer | string>>;
    try {
      const r = await client.query(
        `SELECT ${tabela.pk} AS pk, encrypted_data_key, iv, auth_tag, ciphertext FROM ${tabela.nome}`,
      );
      linhas = r.rows as Array<Record<string, Buffer | string>>;
    } catch {
      // Tabela que nao existe neste banco nao e erro: o schema evoluiu, e nem
      // todo ambiente tem todas (ex: waitlist_signups_enc e recente).
      console.log(`${tabela.nome.padEnd(22)} (nao existe neste banco - pulando)`);
      continue;
    }

    let ok = 0;
    for (const linha of linhas) {
      const payload = {
        encryptedDataKey: linha.encrypted_data_key as Buffer,
        iv: linha.iv as Buffer,
        authTag: linha.auth_tag as Buffer,
        ciphertext: linha.ciphertext as Buffer,
      };

      try {
        /*
         * Abre a DEK com a chave velha e fecha com a nova. O conteudo em si
         * nunca e decifrado - so o envelope. E a prova de que a chave velha
         * de fato abre esta linha: se --old estiver errada, falha AQUI, antes
         * de qualquer escrita.
         */
        const dek = await new LocalDevKeyProvider(args.old).decryptDataKey(payload.encryptedDataKey);
        const reempacotada = await novaProvider.encryptDataKey(dek);
        dek.fill(0);

        if (!args.dryRun) {
          await client.query(
            `UPDATE ${tabela.nome} SET encrypted_data_key = $1 WHERE ${tabela.pk} = $2`,
            [reempacotada, linha.pk],
          );
        }
        ok++;
      } catch (err) {
        falhas++;
        console.log(`  FALHA em ${tabela.nome}.${String(linha.pk)}: ${err instanceof Error ? err.message : err}`);
      }
    }

    total += ok;
    console.log(`${tabela.nome.padEnd(22)} ${ok}/${linhas.length} linha(s) ${args.dryRun ? "reempacotariam" : "reempacotadas"}`);
  }

  // Verificacao: com a chave NOVA, o dado ainda abre? Sem isto, a rotacao
  // "funciona" e so descobre o problema quando um alerta precisar sair.
  if (!args.dryRun && falhas === 0) {
    console.log("\nVerificando com a chave NOVA...");
    const nova = new MappingEncryption(novaProvider);
    const amostra = await client.query(
      `SELECT encrypted_data_key, iv, auth_tag, ciphertext FROM phone_mappings LIMIT 1`,
    ).catch(() => null);
    const linha = amostra?.rows?.[0] as Record<string, Buffer> | undefined;
    if (linha) {
      try {
        await nova.decrypt({
          encryptedDataKey: linha.encrypted_data_key,
          iv: linha.iv,
          authTag: linha.auth_tag,
          ciphertext: linha.ciphertext,
        });
        console.log("OK: um registro foi decifrado com a chave nova.");
      } catch (err) {
        console.log(`PROBLEMA: a chave nova NAO decifra. ${err instanceof Error ? err.message : err}`);
        console.log("NAO troque a variavel de ambiente ainda. Investigue antes.");
        falhas++;
      }
    } else {
      console.log("(sem registro em phone_mappings pra verificar - verifique manualmente depois)");
    }
  }

  await client.end();

  console.log("\n=== Resumo ===");
  console.log(`linhas ${args.dryRun ? "que seriam reempacotadas" : "reempacotadas"}: ${total}`);
  console.log(`falhas: ${falhas}`);

  if (falhas > 0) {
    console.log("\nNAO troque ENCRYPTION_KEY_KMS_ARN com falhas pendentes.");
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log("\nSimulacao ok. Rode de novo sem --dry-run pra valer.");
    return;
  }

  console.log("\nAgora sim: troque ENCRYPTION_KEY_KMS_ARN pela chave nova no provedor e aplique.");
  console.log("O app so volta a funcionar com a chave nova - as DEKs ja foram reempacotadas.");
  console.log("\nLembrete honesto: rotacionar fecha a porta pra frente. Se a chave velha vazou");
  console.log("junto com um dump do banco, o conteudo que saiu continua legivel por quem o tem.");
}

void main().catch((err) => {
  console.error("[fatal]", err instanceof Error ? err.message : err);
  process.exit(1);
});
