/**
 * Verifica (ou imprime) a mensagem de assinatura do CONTRIBUTOR-AGREEMENT.md
 * - mesmo padrão EIP-191 já usado em privacy/ownership-proof.ts (personal_sign,
 *   sem gás, sem mover fundos). O hash do documento entra na mensagem pra a
 *   assinatura ficar vinculada ao conteúdo exato daquela versão: se o texto
 *   do acordo mudar, toda assinatura anterior aponta pra um hash diferente
 *   e fica visivelmente inválida pra versão nova, sem precisar de nada além
 *   de reler o arquivo.
 *
 * O acordo em si é um documento PRIVADO (não fica no repo público, nem
 * commitado aqui - ver nota em CONTRIBUTOR-AGREEMENT.md sobre onde ele vive
 * de verdade). Por isso o hash pode vir de duas formas: lendo um arquivo
 * local (quem tem uma cópia, ex: o fundador) ou recebendo o hash já
 * calculado por fora (quem só tem o link do documento privado) via --hash.
 *
 * Uso:
 *   npx tsx scripts/verify-contributor-signature.ts --message --hash <sha256> [--prize-ask "<pedido>"] [--salary-ask "<expectativa>"]
 *     -> imprime a mensagem exata pra assinar com personal_sign
 *
 *   npx tsx scripts/verify-contributor-signature.ts --login <github> --address <0x..> --signature <0x..> --hash <sha256> [--prize-ask "..."] [--salary-ask "..."]
 *     -> confirma se a assinatura é válida pro hash e pelos pedidos informados (precisam ser EXATAMENTE
 *        os mesmos usados pra gerar a mensagem assinada, senão a verificação falha - é assim que um
 *        pedido declarado não pode ser trocado depois sem assinar de novo)
 *
 *   (omitir --hash em qualquer um dos dois comandos usa CONTRIBUTOR-AGREEMENT.md
 *   local, se existir - só funciona pra quem tem uma cópia no mesmo caminho.
 *   omitir --prize-ask/--salary-ask assina sem pedido declarado naquele ponto.)
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { type Address, verifyMessage } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGREEMENT_PATH = join(__dirname, "..", "CONTRIBUTOR-AGREEMENT.md");
const AGREEMENT_VERSION = "v2-2026-10-07";

function agreementHash(explicitHash?: string): string {
  if (explicitHash) return explicitHash;
  if (!existsSync(AGREEMENT_PATH)) {
    throw new Error(
      "CONTRIBUTOR-AGREEMENT.md não encontrado localmente. Informe --hash <sha256> com o valor publicado junto do link do documento privado.",
    );
  }
  const contents = readFileSync(AGREEMENT_PATH, "utf8");
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Mesma estrutura de buildOwnershipChallenge() em privacy/ownership-proof.ts -
 * lista de linhas, não um template solto. prizeAsk/salaryAsk são o PEDIDO
 * DECLARADO do próprio colaborador (§3/§4 do acordo) - entram dentro da
 * mensagem assinada de propósito, não como campo solto depois: assim, trocar
 * o pedido sem assinar de novo invalida a assinatura automaticamente.
 */
export function buildAgreementChallenge(params: {
  githubLogin: string;
  address: Address;
  hash?: string;
  prizeAsk?: string;
  salaryAsk?: string;
}): string {
  return [
    "VILIGION - Acordo de Colaborador",
    "Documento: CONTRIBUTOR-AGREEMENT.md (documento privado, não publicado no repositório)",
    `Versão: ${AGREEMENT_VERSION}`,
    `Hash SHA-256: ${agreementHash(params.hash)}`,
    `Colaborador (GitHub): ${params.githubLogin}`,
    `Endereço: ${params.address}`,
    `Pedido declarado - premiação (§3): ${params.prizeAsk ?? "não declarado"}`,
    `Pedido declarado - remuneração/equity futura (§4/§6): ${params.salaryAsk ?? "não declarado"}`,
    "Esta assinatura confirma que li e concordo com os termos do Acordo de Colaborador VILIGION nesta versão, incluindo a divisão de premiação (§3) e a cláusula de intenção de equity futura (§6, não vinculante), e que os pedidos declarados acima são os meus, sujeitos à revisão e aprovação do fundador antes de qualquer distribuição real.",
  ].join("\n");
}

export async function verifyAgreementSignature(params: {
  githubLogin: string;
  address: Address;
  signature: `0x${string}`;
  hash?: string;
  prizeAsk?: string;
  salaryAsk?: string;
}): Promise<boolean> {
  const message = buildAgreementChallenge(params);
  return verifyMessage({ address: params.address, message, signature: params.signature });
}

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const hash = typeof args.hash === "string" ? args.hash : undefined;
  const prizeAsk = typeof args["prize-ask"] === "string" ? args["prize-ask"] : undefined;
  const salaryAsk = typeof args["salary-ask"] === "string" ? args["salary-ask"] : undefined;

  if (args.message) {
    const login = typeof args.login === "string" ? args.login : "<seu-login-do-github>";
    const address = typeof args.address === "string" ? (args.address as Address) : ("0xSEU_ENDERECO" as Address);
    console.log(buildAgreementChallenge({ githubLogin: login, address, hash, prizeAsk, salaryAsk }));
    return;
  }

  const login = args.login;
  const address = args.address;
  const signature = args.signature;
  if (typeof login !== "string" || typeof address !== "string" || typeof signature !== "string") {
    console.error(
      "Uso: --message  OU  --login <github> --address <0x..> --signature <0x..>  [--hash <sha256>] [--prize-ask \"...\"] [--salary-ask \"...\"]",
    );
    process.exitCode = 1;
    return;
  }

  const valid = await verifyAgreementSignature({
    githubLogin: login,
    address: address as Address,
    signature: signature as `0x${string}`,
    hash,
    prizeAsk,
    salaryAsk,
  });

  if (valid) {
    console.log(`✔ Assinatura válida para ${login} (${address}), versão ${AGREEMENT_VERSION}.`);
  } else {
    console.error(`✘ Assinatura INVÁLIDA para ${login} (${address}) na versão ${AGREEMENT_VERSION} — não bate com o hash atual do documento.`);
    process.exitCode = 1;
  }
}

// Só executa o CLI quando o arquivo é chamado diretamente (tsx scripts/...) -
// buildAgreementChallenge/verifyAgreementSignature também são importáveis
// por outro código (ex: testes) sem disparar o parse de argv.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
