/**
 * Acesso de jurado: sessão de UM fator, com escrita limitada e prazo de morte.
 *
 * Por que existe: a ferramenta de análise da submissão recomendou reduzir o
 * atrito de avaliação. Exigir que um jurado - ou o agente dele - configure um
 * app autenticador antes de ver qualquer coisa custa minutos de uma avaliação
 * que dura minutos. E sem login não se vê nada: painel, alertas, preview de
 * conteúdo e limiares são todos autenticados.
 *
 * O que NÃO se pode perder ao atender isso: a submissão afirma, por escrito,
 * que trocar o destinatário de um alerta exige senha E TOTP. Um atalho de um
 * fator capaz de trocar destinatário tornaria essa frase falsa - e num produto
 * cuja tese é modelo de ameaça, o jurado que abre o código e encontra a
 * contradição perde a confiança no resto.
 *
 * A saída foi escopo, não fator. O jurado CONFIGURA o produto (cadastra conta
 * monitorada, edita limiares) e vê tudo - menos duas coisas:
 *
 * - trocar destinatário de alerta, que é a ação que a submissão diz exigir
 *   dois fatores;
 * - disparar alerta de teste, que tocaria uma ligação REAL no telefone do
 *   dono e gastaria crédito Twilio a cada jurado que clicasse.
 *
 * E uma leitura negada: `/recipients`, que mostra o telefone real do dono por
 * extenso. Ver LEITURAS_NEGADAS.
 *
 * Toda decisão passa por `judgeMayAccess`, um ponto único. Escrita é
 * permitida por LISTA EXPLÍCITA: numa política de acesso o default tem que ser
 * negar, pra que uma rota nova nasça bloqueada em vez de aberta.
 *
 * Mais quatro limites, porque "temporário" sem mecanismo é permanente:
 *
 * - DESLIGADO por padrão. Sem `JUDGE_ACCESS_PASSWORD` e `JUDGE_ACCESS_USERNAME`
 *   no ambiente, este caminho não existe - inclusive em qualquer clone.
 * - MORRE sozinho em `JUDGE_ACCESS_EXPIRES_AT`, sem ninguém lembrar de nada.
 * - RATE LIMITED pelo limitador de login que já existia - única barreira num
 *   caminho sem segundo fator.
 * - LOGA toda requisição, permitida ou negada, pra que o acesso seja
 *   auditável depois (ver docs/JUDGE-ACCESS.md).
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
 * Rotas de ESCRITA que uma sessão de jurado pode executar.
 *
 * Lista curta e explícita, em vez de "tudo que não for proibido": numa
 * política de acesso, o default tem que ser negar. Uma rota de escrita que
 * alguém adicionar amanhã nasce bloqueada para o jurado até que alguém
 * decida, conscientemente, colocá-la aqui.
 *
 * Por que estas duas entram: cadastrar conta monitorada e editar limiares são
 * o produto sendo CONFIGURADO. É o que um avaliador precisa fazer pra julgar
 * se a coisa funciona, e o estrago possível é dado de demonstração numa
 * testnet.
 */
const ESCRITAS_PERMITIDAS: ReadonlySet<string> = new Set(["POST /accounts", "POST /thresholds"]);

/**
 * Leituras NEGADAS, mesmo sendo GET.
 *
 * `/recipients` lista para onde o alerta vai — hoje, o número de telefone
 * real do dono, por extenso. Num produto cuja tese inteira é não ligar um
 * número a uma tesouraria, essa é a última página que deveria abrir para um
 * terceiro. O endpoint de push já aparece só pelo host (ver
 * push-subscription.ts), mas telefone e e-mail não.
 *
 * O jurado não perde nada relevante: `/alerts/preview` mostra o conteúdo
 * exato de cada canal sem enviar nada, e o histórico em `/alerts` prova quais
 * canais entregaram de verdade.
 */
const LEITURAS_NEGADAS: ReadonlyMap<string, string> = new Map([
  [
    "/recipients",
    "Esta página lista para onde os alertas são enviados — incluindo um número de telefone real. " +
      "Não expomos isso a uma sessão de avaliação: é exatamente o dado que este produto existe para proteger.",
  ],
]);

export interface JudgeDecision {
  readonly allowed: boolean;
  /** Por que foi negado, em linguagem para quem leu a recusa na tela. */
  readonly reason?: string;
}

/**
 * O que uma sessão de jurado pode fazer. PONTO ÚNICO de decisão.
 *
 * Tudo passa por aqui antes de qualquer rota, então não há caminho que escape
 * por esquecimento em um handler.
 */
export function judgeMayAccess(method: string | undefined, rawUrl: string | undefined): JudgeDecision {
  const verbo = (method ?? "GET").toUpperCase();
  // Tira query string e barra final: `/thresholds?salvo=1` é a mesma rota.
  const caminho = (rawUrl ?? "/").split("?")[0]?.replace(/\/+$/, "") || "/";

  if (verbo === "GET") {
    const negada = LEITURAS_NEGADAS.get(caminho);
    if (negada) return { allowed: false, reason: negada };
    return { allowed: true };
  }

  if (ESCRITAS_PERMITIDAS.has(`${verbo} ${caminho}`)) return { allowed: true };

  return {
    allowed: false,
    reason:
      "Esta sessão de avaliação não altera destinos de alerta nem dispara alertas. " +
      "Cadastrar conta monitorada e editar limiares funcionam normalmente.",
  };
}

/** Página de recusa que EXPLICA, em vez de só devolver 403 e parecer quebrado. */
export function readOnlyNoticeHtml(reason: string): string {
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
    <p>Você entrou com a senha de avaliação, que usa um fator só para não tomar seu tempo com a configuração de um autenticador. <strong>Cadastrar conta monitorada e editar limiares funcionam normalmente.</strong></p>
    <p>${escapeForNotice(reason)}</p>
    <p>Trocar destinatário de alerta e disparar alerta de teste exigem o login completo, com senha e código TOTP — a mesma regra que a submissão descreve.</p>
    <p>Disparar um alerta de teste também tocaria uma ligação real no telefone do dono e consumiria crédito da conta Twilio dele — por isso fica de fora.</p>
    <p>Para ver o conteúdo exato de cada canal de alerta sem enviar nada, abra <a href="/alerts/preview">/alerts/preview</a>.</p>
    <p><a href="/dashboard">Voltar ao painel</a></p>
  </div>
</body>
</html>`;
}

/** Escapa o motivo antes de interpolar - ele é texto nosso, mas a regra do projeto é escapar sempre. */
function escapeForNotice(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
