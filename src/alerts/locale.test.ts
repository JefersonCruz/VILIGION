import { describe, expect, it } from "vitest";
import { resolveLocale, twilioSayLanguage } from "./locale.js";

describe("resolveLocale", () => {
  it("default é inglês quando ALERT_LOCALE está ausente - pensado pro vídeo de demo", () => {
    expect(resolveLocale({})).toBe("en");
  });

  it("default é inglês pra qualquer valor que não seja exatamente 'pt'", () => {
    expect(resolveLocale({ ALERT_LOCALE: "es" })).toBe("en");
    expect(resolveLocale({ ALERT_LOCALE: "" })).toBe("en");
  });

  it("troca pra português quando ALERT_LOCALE=pt - config, não código novo", () => {
    expect(resolveLocale({ ALERT_LOCALE: "pt" })).toBe("pt");
  });
});

describe("twilioSayLanguage", () => {
  it("mapeia pro código de idioma aceito pelo <Say> da Twilio", () => {
    expect(twilioSayLanguage("en")).toBe("en-US");
    expect(twilioSayLanguage("pt")).toBe("pt-BR");
  });
});
