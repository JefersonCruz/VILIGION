import { describe, expect, it } from "vitest";
import {
  isJudgeAccessOpen,
  isJudgeLogin,
  JUDGE_ACCESS_EXPIRES_AT,
  JudgeSessions,
  readJudgeAccessConfig,
  refusalNoticeHtml,
  judgeMayAccess,
} from "./judge-access.js";

const SENHA = "senha-de-avaliacao-longa";
const config = { password: SENHA, username: "henri" };

describe("acesso de jurado: desligado por padrão", () => {
  it("sem variáveis de ambiente, o caminho não existe", () => {
    // O estado normal: qualquer clone, qualquer ambiente de desenvolvimento.
    expect(readJudgeAccessConfig({})).toBeNull();
  });

  it("senha sem usuário, ou usuário sem senha, não habilita nada", () => {
    expect(readJudgeAccessConfig({ JUDGE_ACCESS_PASSWORD: SENHA })).toBeNull();
    expect(readJudgeAccessConfig({ JUDGE_ACCESS_USERNAME: "henri" })).toBeNull();
  });

  it("recusa senha curta - sem segundo fator, ela é a única barreira", () => {
    const cfg = readJudgeAccessConfig({ JUDGE_ACCESS_PASSWORD: "curta", JUDGE_ACCESS_USERNAME: "henri" });

    expect(cfg).toBeNull();
  });

  it("com as duas variáveis e senha longa, habilita", () => {
    const cfg = readJudgeAccessConfig({ JUDGE_ACCESS_PASSWORD: SENHA, JUDGE_ACCESS_USERNAME: "henri" });

    expect(cfg).toEqual({ password: SENHA, username: "henri" });
  });
});

describe("acesso de jurado: morre sozinho", () => {
  it("está aberto antes do prazo", () => {
    expect(isJudgeAccessOpen(new Date(JUDGE_ACCESS_EXPIRES_AT.getTime() - 1000))).toBe(true);
  });

  it("fecha depois do prazo, sem ninguém remover nada", () => {
    expect(isJudgeAccessOpen(new Date(JUDGE_ACCESS_EXPIRES_AT.getTime() + 1000))).toBe(false);
  });

  it("depois do prazo, nem a senha certa entra", () => {
    // "Temporário" sem mecanismo é permanente. Este teste é o mecanismo.
    const depois = new Date(JUDGE_ACCESS_EXPIRES_AT.getTime() + 86_400_000);

    expect(isJudgeLogin(config, { username: "henri", password: SENHA }, depois)).toBe(false);
  });
});

describe("acesso de jurado: reconhecimento da tentativa", () => {
  it("usuário e senha corretos, dentro do prazo", () => {
    expect(isJudgeLogin(config, { username: "henri", password: SENHA })).toBe(true);
  });

  it("senha errada não entra", () => {
    expect(isJudgeLogin(config, { username: "henri", password: "outra-coisa-longa" })).toBe(false);
  });

  it("usuário errado não entra, mesmo com a senha certa", () => {
    expect(isJudgeLogin(config, { username: "outro", password: SENHA })).toBe(false);
  });

  it("com o acesso desligado, nenhuma combinação entra", () => {
    expect(isJudgeLogin(null, { username: "henri", password: SENHA })).toBe(false);
  });
});

describe("política de acesso: o que o jurado pode fazer", () => {
  const permitido = (m: string, u: string) => judgeMayAccess(m, u).allowed;

  it("pode CONFIGURAR o produto: cadastrar conta e editar limiares", () => {
    // É o que um avaliador precisa fazer pra julgar se a coisa funciona, e o
    // estrago possível é dado de demonstração numa testnet.
    expect(permitido("POST", "/accounts")).toBe(true);
    expect(permitido("POST", "/thresholds")).toBe(true);
  });

  it("NÃO troca destinatário de alerta - é a ação que a submissão diz exigir dois fatores", () => {
    expect(permitido("POST", "/recipients")).toBe(false);
    expect(permitido("POST", "/recipients/abc/delete")).toBe(false);
    expect(permitido("POST", "/push/subscribe")).toBe(false);
  });

  it("NÃO dispara alerta de teste - tocaria uma ligação real e gastaria crédito Twilio", () => {
    expect(permitido("POST", "/recipients/test")).toBe(false);
  });

  it("NÃO abre /recipients nem para leitura - mostra o telefone real do dono", () => {
    const decisao = judgeMayAccess("GET", "/recipients");

    expect(decisao.allowed).toBe(false);
    expect(decisao.reason).toContain("telefone");
  });

  it("lê tudo o que importa para avaliar", () => {
    for (const rota of ["/dashboard", "/alerts", "/alerts/preview", "/thresholds", "/accounts"]) {
      expect(permitido("GET", rota)).toBe(true);
    }
  });

  it("escrita é por lista explícita - uma rota nova nasce BLOQUEADA", () => {
    /**
     * O ponto do desenho. Se alguém adicionar amanhã uma rota de escrita e
     * esquecer desta política, o jurado não a alcança - em vez de alcançar
     * por omissão, que é como política de acesso costuma falhar.
     */
    expect(permitido("POST", "/rota-que-alguem-adicionar-amanha")).toBe(false);
    expect(permitido("DELETE", "/accounts")).toBe(false);
    expect(permitido("PUT", "/thresholds")).toBe(false);
  });

  it("query string e barra final não contornam a política", () => {
    // `/recipients?x=1` e `/recipients/` são a mesma rota negada.
    expect(permitido("GET", "/recipients?qualquer=1")).toBe(false);
    expect(permitido("GET", "/recipients/")).toBe(false);
  });

  it("a negação sempre explica o motivo - 403 seco pareceria o sistema quebrado", () => {
    expect(judgeMayAccess("POST", "/recipients/test").reason).toBeTruthy();
  });
});

describe("marcação de sessões de jurado", () => {
  it("marca e reconhece o token", () => {
    const js = new JudgeSessions();
    js.mark("abc");

    expect(js.isJudgeSession("abc")).toBe(true);
  });

  it("token não marcado é sessão normal - o login completo não é afetado", () => {
    const js = new JudgeSessions();
    js.mark("abc");

    expect(js.isJudgeSession("xyz")).toBe(false);
    expect(js.isJudgeSession(undefined)).toBe(false);
  });

  it("logout esquece a marca", () => {
    const js = new JudgeSessions();
    js.mark("abc");
    js.forget("abc");

    expect(js.isJudgeSession("abc")).toBe(false);
  });

  it("o conjunto é limitado - não vaza memória num processo que roda sem parar", () => {
    const js = new JudgeSessions();
    for (let i = 0; i < JudgeSessions.MAX_TRACKED + 50; i++) js.mark(`t${i}`);

    // o mais antigo saiu; o mais recente continua
    expect(js.isJudgeSession("t0")).toBe(false);
    expect(js.isJudgeSession(`t${JudgeSessions.MAX_TRACKED + 49}`)).toBe(true);
  });

  it("perder a marca de um token antigo falha para o lado seguro", () => {
    // Um token esquecido deixa de ser tratado como jurado e cai na checagem
    // normal de sessão - que, para um token antigo, já terá expirado.
    const js = new JudgeSessions();
    expect(js.isJudgeSession("token-que-nunca-foi-marcado")).toBe(false);
  });
});

describe("a recusa explica, em vez de parecer quebrada", () => {
  const html = () => refusalNoticeHtml("Motivo de teste.");

  it("mostra o motivo específico da recusa", () => {
    expect(html()).toContain("Motivo de teste.");
  });

  it("diz o que AINDA funciona, pro jurado não achar que travou tudo", () => {
    expect(html()).toContain("Cadastrar conta monitorada e editar limiares funcionam normalmente");
  });

  it("aponta o caminho que mostra o conteúdo do alerta sem disparar nada", () => {
    expect(html()).toContain("/alerts/preview");
  });

  it("escapa o motivo antes de interpolar", () => {
    // O motivo é texto nosso, mas a regra do projeto é escapar sempre.
    expect(refusalNoticeHtml("<script>x</script>")).not.toContain("<script>x");
  });
});
