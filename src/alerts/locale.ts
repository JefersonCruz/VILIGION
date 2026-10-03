/**
 * Idioma do conteúdo de alerta (voz/e-mail) - mapa com só 2 opções de
 * propósito, NÃO é sistema de i18n completo (sem seleção por usuário, sem
 * arquivo de tradução por região). Decisão: default "en" porque o público
 * imediato (vídeo de demo do hackathon, jurados internacionais) precisa
 * entender o conteúdo falado/escrito; o público real de GTM inicial (PME
 * brasileira, ver docs/BUSINESS-PLAN.md) troca pra "pt" via env var - é
 * configuração, não código novo, pra atender o primeiro cliente real.
 */

export type AlertLocale = "en" | "pt";

export function resolveLocale(env: NodeJS.ProcessEnv = process.env): AlertLocale {
  return env.ALERT_LOCALE === "pt" ? "pt" : "en";
}

/** Código de idioma aceito pelo <Say> da Twilio - ver twilio-voice.ts. */
export function twilioSayLanguage(locale: AlertLocale): "pt-BR" | "en-US" {
  return locale === "pt" ? "pt-BR" : "en-US";
}
