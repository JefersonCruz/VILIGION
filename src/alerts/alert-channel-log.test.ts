import { describe, expect, it } from "vitest";
import { CANAL_NENHUM, canalDoRegistro } from "./alert-channel-log.js";

const tudo = { push: true, voice: true, email: true };
const nada = { push: false, voice: false, email: false };

describe("canal declarado no histórico de alertas", () => {
  it("crítico com os dois canais declara os dois", () => {
    expect(canalDoRegistro("critical", tudo)).toBe("push+voice");
  });

  it("crítico só com ligação declara ligação", () => {
    expect(canalDoRegistro("critical", { ...nada, voice: true })).toBe("voice");
  });

  it("crítico só com push declara push - é o caso de quem não usa Twilio", () => {
    expect(canalDoRegistro("critical", { ...nada, push: true })).toBe("push");
  });

  it("crítico SEM canal nenhum declara 'nenhum', não 'voice'", () => {
    // O defeito corrigido: gravava "voice" e o painel mostrava "Ligação"
    // para um alerta que não foi enviado por canal algum.
    expect(canalDoRegistro("critical", nada)).toBe(CANAL_NENHUM);
    expect(canalDoRegistro("critical", nada)).not.toBe("voice");
  });

  it("normal com SMTP declara e-mail", () => {
    expect(canalDoRegistro("normal", { ...nada, email: true })).toBe("email");
  });

  it("normal SEM SMTP declara 'nenhum', não 'email'", () => {
    expect(canalDoRegistro("normal", nada)).toBe(CANAL_NENHUM);
    expect(canalDoRegistro("normal", nada)).not.toBe("email");
  });

  it("canal crítico não vaza para o normal, nem o contrário", () => {
    // ter ligação configurada não faz um alerta normal sair por ligação
    expect(canalDoRegistro("normal", { push: true, voice: true, email: false })).toBe(CANAL_NENHUM);
    // ter SMTP configurado não dá canal a um alerta crítico
    expect(canalDoRegistro("critical", { push: false, voice: false, email: true })).toBe(CANAL_NENHUM);
  });
});
