import { describe, expect, it } from "vitest";
import {
  isJudgeAccessOpen,
  isJudgeLogin,
  JUDGE_ACCESS_EXPIRES_AT,
  JudgeSessions,
  readJudgeAccessConfig,
  readOnlyNoticeHtml,
  rejectsWrite,
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

describe("escopo somente leitura", () => {
  it("GET passa", () => {
    expect(rejectsWrite("GET")).toBe(false);
    expect(rejectsWrite("get")).toBe(false);
    expect(rejectsWrite(undefined)).toBe(false);
  });

  it("todo método que altera estado é recusado", () => {
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(rejectsWrite(metodo)).toBe(true);
    }
  });

  it("a regra é por MÉTODO, não por lista de rotas", () => {
    /**
     * O ponto do desenho: uma rota de escrita que alguém adicionar amanhã já
     * nasce bloqueada para o jurado. Uma lista de rotas protegeria só o que
     * estava nela no dia em que foi escrita.
     */
    expect(rejectsWrite("POST")).toBe(true);
  });
});

describe("marcação de sessões de jurado", () => {
  it("marca e reconhece o token", () => {
    const js = new JudgeSessions();
    js.mark("abc");

    expect(js.isReadOnly("abc")).toBe(true);
  });

  it("token não marcado é sessão normal - o login completo não é afetado", () => {
    const js = new JudgeSessions();
    js.mark("abc");

    expect(js.isReadOnly("xyz")).toBe(false);
    expect(js.isReadOnly(undefined)).toBe(false);
  });

  it("logout esquece a marca", () => {
    const js = new JudgeSessions();
    js.mark("abc");
    js.forget("abc");

    expect(js.isReadOnly("abc")).toBe(false);
  });

  it("o conjunto é limitado - não vaza memória num processo que roda sem parar", () => {
    const js = new JudgeSessions();
    for (let i = 0; i < JudgeSessions.MAX_TRACKED + 50; i++) js.mark(`t${i}`);

    // o mais antigo saiu; o mais recente continua
    expect(js.isReadOnly("t0")).toBe(false);
    expect(js.isReadOnly(`t${JudgeSessions.MAX_TRACKED + 49}`)).toBe(true);
  });

  it("perder a marca de um token antigo falha para o lado seguro", () => {
    // Um token esquecido deixa de ser tratado como jurado e cai na checagem
    // normal de sessão - que, para um token antigo, já terá expirado.
    const js = new JudgeSessions();
    expect(js.isReadOnly("token-que-nunca-foi-marcado")).toBe(false);
  });
});

describe("a recusa explica, em vez de parecer quebrada", () => {
  it("diz que é sessão de avaliação e por que não altera nada", () => {
    const html = readOnlyNoticeHtml();

    expect(html).toContain("somente leitura");
    expect(html).toContain("TOTP");
  });

  it("aponta o caminho que mostra o conteúdo do alerta sem disparar nada", () => {
    expect(readOnlyNoticeHtml()).toContain("/alerts/preview");
  });

  it("explica que disparar teste tocaria uma ligação real", () => {
    // O jurado precisa entender que é consideração, não limitação arbitrária.
    expect(readOnlyNoticeHtml()).toContain("ligação real");
  });
});
