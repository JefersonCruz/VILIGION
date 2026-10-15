/**
 * Acesso de jurado: sessão de UM fator, SOMENTE LEITURA, com prazo de morte.
 *
 * Por que existe: a ferramenta de análise da submissão recomendou reduzir o
 * atrito de avaliação. Exigir que um jurado - ou o agente dele - configure um
 * app autenticador antes de ver qualquer coisa custa minutos de uma avaliação
 * que dura minutos.
 *
 * O que NÃO se pode perder ao atender isso: a submissão afirma, por escrito,
 * que trocar o destinatário de um alerta exige senha E TOTP. Um atalho que
 * pulasse o segundo fator num acesso capaz de ESCREVER tornaria essa frase
 * falsa - e num produto cuja tese é modelo de ameaça, um jurado que abre o
 * código e encontra a contradição perde a confiança no resto.
 *
 * A saída é escopo, não fator. Esta sessão não consegue escrever nada:
 *
 * - somente GET. Qualquer método que altere estado é recusado num ponto
 *   único de decisão (ver `rejectsWrite`), não rota a rota. Lista de rotas se
 *   desatualiza quando alguém adiciona uma; "só GET" não.
 * - a afirmação da submissão continua verdadeira, porque trocar destinatário
 *   é POST, e POST não passa.
 *
 * Mais três limites, porque "temporário" sem mecanismo é permanente:
 *
 * - DESLIGADO por padrão. Sem `JUDGE_ACCESS_PASSWORD` no ambiente, este
 *   caminho não existe - inclusive em qualquer clone que alguém rode.
 * - MORRE sozinho em `JUDGE_ACCESS_EXPIRES_AT`, sem ninguém precisar lembrar
 *   de remover nada.
 * - LOGA todo uso, pra que o acesso seja auditável depois.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Quando o acesso de jurado para de funcionar, independentemente de env.
 *
 * Data fixa no código, e não variável de ambiente, de propósito: o prazo é
 * informação de SEGURANÇA, e tem que ser legível por quem revisa o
 * repositório. Uma expiração que vive só no painel de um provedor é uma
 * expiração que ninguém consegue auditar.
 *
 * Cobre o julgamento e eventuais entrevistas de aceleradora. Depois disso, a
 * única forma de reabrir é mudar esta linha - num commit, com revisão.
 */
export const JUDGE_ACCESS_EXPIRES_AT = new Date("2026-11-14T23:59:59Z");

export interface JudgeAccessConfig {
  /** Senha de uso exclusivo do jurado. NUNCA a senha real da conta. */
  readonly password: string;
  /** Conta cujos dados o jurado enxerga. */
  readonly username: string;
}

/**
 * Lê a configuração do ambiente, ou `null` quando o acesso está desligado.
 *
 * `null` é o caminho normal: em desenvolvimento, em qualquer clone, e em
 * produção depois que o prazo passar, isto devolve `null` e o login de jurado
 * simplesmente não é uma possibilidade.
 */
export function readJudgeAccessConfig(env: NodeJS.ProcessEnv): JudgeAccessConfig | null {
  const password = env.JUDGE_ACCESS_PASSWORD;
  const username = env.JUDGE_ACCESS_USERNAME;
  if (!password || !username) return null;
  /**
   * Senha curta demais vira acesso aberto na prática: este caminho não tem
   * segundo fator, então ela é a única barreira. Recusar aqui é melhor que
   * depender de quem configurou ter escolhido bem.
   */
  if (password.length < 12) {
    console.error("[jurado] JUDGE_ACCESS_PASSWORD tem menos de 12 caracteres - acesso de jurado NÃO habilitado.");
    return null;
  }
  return { password, username };
}

/** `false` depois do prazo - checado a cada tentativa, não só no boot. */
export function isJudgeAccessOpen(now: Date = new Date()): boolean {
  return now.getTime() < JUDGE_ACCESS_EXPIRES_AT.getTime();
}

/**
 * A tentativa de login é de jurado?
 *
 * Comparação em tempo constante, igual ao resto do projeto (ver
 * dashboard/password.ts): uma comparação com `===` vaza, pelo tempo, quantos
 * caracteres iniciais estão certos.
 *
 * Compara o usuário primeiro e a senha sempre, mesmo quando o usuário já não
 * bate, pra que o tempo de resposta não revele se aquele nome de usuário é o
 * da conta de demonstração.
 */
export function isJudgeLogin(
  config: JudgeAccessConfig | null,
  attempt: { username: string; password: string },
  now: Date = new Date(),
): boolean {
  if (!config || !isJudgeAccessOpen(now)) return false;
  const userOk = constantTimeEquals(attempt.username, config.username);
  const passOk = constantTimeEquals(attempt.password, config.password);
  return userOk && passOk;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual lança se os tamanhos diferem - o próprio tamanho não é
  // segredo, então comparar antes é aceitável e evita o lançamento.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Quais tokens de sessão são de jurado.
 *
 * Vive aqui, e não dentro de `Session`, de propósito: "somente leitura" é
 * uma decisão de AUTORIZAÇÃO do painel, não uma propriedade do ciclo de vida
 * da sessão. Manter separado também deixa `session.ts` livre pra evoluir
 * (expiração deslizante, teto absoluto) sem que esta feature atrapalhe.
 */
export class JudgeSessions {
  private readonly tokens = new Set<string>();

  /**
   * Limite de tokens lembrados. Um conjunto que só cresce num processo que
   * roda indefinidamente é vazamento de memória lento; o mais antigo sai
   * quando passa daqui. Perder a marca de um token antigo é seguro: ele deixa
   * de ser tratado como jurado e passa a cair na checagem normal de sessão,
   * que já terá expirado.
   */
  static readonly MAX_TRACKED = 200;

  mark(token: string): void {
    this.tokens.add(token);
    while (this.tokens.size > JudgeSessions.MAX_TRACKED) {
      const oldest = this.tokens.values().next();
      if (oldest.done) break;
      this.tokens.delete(oldest.value);
    }
  }

  isReadOnly(token: string | undefined): boolean {
    return token !== undefined && this.tokens.has(token);
  }

  forget(token: string | undefined): void {
    if (token !== undefined) this.tokens.delete(token);
  }
}

/**
 * Uma sessão de jurado pode executar esta requisição?
 *
 * O ponto único de decisão do escopo somente-leitura. Deliberadamente baseado
 * no MÉTODO, e não numa lista de rotas: toda rota que altera estado neste
 * painel é POST (contas, limiares, destinatários, alerta de teste, exclusões),
 * e uma rota nova que alguém adicione amanhã também será. Uma lista de rotas
 * protege o que estava nela no dia em que foi escrita; "só GET" protege o que
 * ainda nem existe.
 */
export function rejectsWrite(method: string | undefined): boolean {
  return (method ?? "GET").toUpperCase() !== "GET";
}

/** Página de recusa que EXPLICA, em vez de só devolver 403 e parecer quebrado. */
export function readOnlyNoticeHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILIGION — sessão somente leitura</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#131217; color:#e7e5ea;
         font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; padding:24px; }
  .card { max-width:520px; border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:24px 26px; line-height:1.6; }
  h1 { font-size:18px; margin:0 0 12px; }
  p { margin:0 0 12px; font-size:14px; color:#b9b5c0; }
  a { color:#e7e5ea; }
</style>
</head>
<body>
  <div class="card">
    <h1>Esta é uma sessão de avaliação, somente leitura</h1>
    <p>Você entrou com a senha de avaliação, que usa um fator só para não tomar seu tempo com a configuração de um autenticador.</p>
    <p>Em troca, ela não altera nada: cadastrar conta, editar limiares, trocar destinatário de alerta ou disparar um alerta de teste exigem o login completo, com senha e código TOTP. É a mesma regra que a submissão descreve, e ela continua valendo aqui.</p>
    <p>Disparar um alerta de teste também tocaria uma ligação real no telefone do dono e consumiria crédito da conta Twilio dele — por isso fica de fora.</p>
    <p>Para ver o conteúdo exato de cada canal de alerta sem enviar nada, abra <a href="/alerts/preview">/alerts/preview</a>.</p>
    <p><a href="/dashboard">Voltar ao painel</a></p>
  </div>
</body>
</html>`;
}
