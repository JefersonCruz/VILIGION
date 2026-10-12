/**
 * Canal de alerta crítico SEM número de telefone (Web Push / RFC 8030+8291).
 *
 * Por que isto existe, e não é só redundância de canal: a ligação telefônica
 * resolve "acordar o dono", mas cria um dado que não dá pra proteger depois -
 * o número. Um número de telefone é atribuível à pessoa, fica em registro de
 * operadora e em CDR da Twilio, e nada no nosso código apaga isso. Push não
 * tem número: o destino é um endpoint opaco emitido pelo navegador, que o
 * próprio usuário pode revogar, e que não identifica pessoa nenhuma.
 *
 * Ou seja, a propriedade de privacidade aqui não vem de criptografia mais
 * forte - vem de NÃO EXISTIR o dado. É o mesmo princípio do resto do produto
 * (ver SECURITY.md): não se entrega o que não se tem.
 *
 * O conteúdo continua vindo de alert-content-policy.ts, igual voz e e-mail -
 * nunca escreva texto de alerta direto aqui. A política é agnóstica de canal,
 * então push herda a mesma garantia testada de não revelar saldo/endereço.
 *
 * NÃO substitui a ligação: push depende do dispositivo ter o PWA instalado e
 * aceitar notificação, e em iOS isso é menos confiável. Os dois canais
 * convivem - ver index.ts#makeDispatcher. O trade-off honesto é que o canal
 * mais privado é o menos garantido, e quem escolhe é o usuário, com a
 * informação na tela (ver /recipients).
 */

import webpush from "web-push";
import type { DetectionEvent } from "../engine/rules/detection-rules.js";
import { assertNoSensitiveData, buildShortAlertMessage, buildShortAlertTitle } from "./alert-content-policy.js";
import { type AlertLocale, resolveLocale } from "./locale.js";

/** Formato que o navegador entrega em PushManager.subscribe() - guardado criptografado, igual telefone/e-mail. */
export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface WebPushConfig {
  vapidPublicKey: string;
  vapidPrivateKey: string;
  /** VAPID exige identificar o remetente - "mailto:..." ou URL. */
  vapidSubject: string;
  /** Base do painel, pra deep link na notificação (só o painel mostra detalhe real). */
  dashboardUrl: string;
}

/** Só o que usamos da lib - permite injetar fake em teste, sem rede (mesmo padrão de TwilioLikeClient). */
export interface WebPushLikeSender {
  sendNotification(
    subscription: PushSubscriptionRecord,
    payload: string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

const OPEN_DASHBOARD: Record<AlertLocale, string> = {
  en: "Open dashboard",
  pt: "Abrir painel",
};

/**
 * TTL curto de propósito: um alerta de tesouraria entregue 6h depois não é
 * alerta, é relatório - e ainda ocuparia fila do push service sem utilidade.
 */
const PUSH_TTL_SECONDS = 15 * 60;

/**
 * Payload que o service worker recebe. Passa pela MESMA checagem de conteúdo
 * da voz/e-mail, incluindo o título - um título tipo "Saldo caiu 40%"
 * apareceria na tela de bloqueio, que é exatamente o cenário de coação que o
 * produto existe pra evitar.
 */
export function buildPushPayload(
  event: DetectionEvent,
  config: Pick<WebPushConfig, "dashboardUrl">,
  locale: AlertLocale = resolveLocale(),
): string {
  const title = buildShortAlertTitle(locale);
  const body = buildShortAlertMessage(event, locale);
  assertNoSensitiveData(title);
  assertNoSensitiveData(body);

  return JSON.stringify({
    title,
    body,
    actionLabel: OPEN_DASHBOARD[locale],
    url: config.dashboardUrl,
    lang: locale === "pt" ? "pt-BR" : "en-US",
    // Horário do EVENTO, não da renderização: uma notificação que ficou na
    // tela a noite toda deve dizer quando o alerta aconteceu, não "agora".
    at: Date.now(),
  });
}

export function createWebPushNotifier(config: WebPushConfig, sender?: WebPushLikeSender) {
  const pushSender: WebPushLikeSender =
    sender ??
    (() => {
      webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
      return webpush;
    })();

  return {
    /**
     * Dispara pra todas as inscrições do usuário. Promise.allSettled pelo
     * mesmo motivo de placeAlertCall: um dispositivo com inscrição expirada
     * não pode impedir a entrega nos outros. Quem inspeciona as rejeições é
     * o chamador (ver logDeliveryFailures em index.ts) - não engolir falha em
     * silêncio foi um bug real de produção em 2026-10-10.
     */
    async sendAlert(params: {
      subscriptions: PushSubscriptionRecord[];
      event: DetectionEvent;
      alertId: string;
      locale?: AlertLocale;
    }): Promise<PromiseSettledResult<unknown>[]> {
      const locale = params.locale ?? resolveLocale();
      const payload = buildPushPayload(params.event, config, locale);

      return Promise.allSettled(
        params.subscriptions.map((subscription) =>
          pushSender.sendNotification(subscription, payload, {
            TTL: PUSH_TTL_SECONDS,
            urgency: "high",
            // Agrupa por alerta: se o mesmo alerta chegar duas vezes, o
            // dispositivo substitui em vez de empilhar duas notificações.
            topic: shortTopic(params.alertId),
          }),
        ),
      );
    },
  };
}

/**
 * O header `Topic` do Web Push aceita no máximo 32 caracteres base64url, e
 * nosso alertId é um UUID com hífens (36) - truncar é seguro aqui porque o
 * topic só serve pra substituir notificação do MESMO alerta no dispositivo,
 * não como identificador em nenhum lugar que precise ser único de verdade.
 */
function shortTopic(alertId: string): string {
  return alertId.replace(/-/g, "").slice(0, 32);
}
