/**
 * Qual canal o histórico de alertas declara.
 *
 * Existe por causa de um defeito de HONESTIDADE, não de entrega. O despacho
 * gravava o canal antes de tentar entregar - de propósito, pra que um alerta
 * fique registrado mesmo se a entrega falhar depois - mas usava um padrão
 * otimista:
 *
 *   const deliveredVia = severity === "critical" ? criticalChannels || "voice" : "email";
 *
 * Quando nenhum canal crítico estava configurado, `criticalChannels` era
 * string vazia e o registro saía como `"voice"`. O código seguia direto pro
 * `return` com "nenhum canal crítico configurado - só logando", ou seja:
 * ninguém foi avisado, e o histórico do painel dizia "Ligação". O mesmo valia
 * pro canal normal, gravado como `"email"` sem SMTP configurado. No caminho de
 * demonstração era pior - `deliveredVia: "voice"` cravado, sem olhar nada.
 *
 * Num produto de vigilância isso é a falha mais grave possível em miniatura: a
 * tela diz que avisou, e não avisou. É a mesma regra que o projeto já impõe aos
 * adaptadores de rede (nunca devolver `0n` pra leitura que falhou) aplicada ao
 * registro de alerta - ver SECURITY.md e docs/ADAPTER_SPEC.md.
 *
 * Esta função declara o que foi de fato TENTADO, e `"nenhum"` quando a
 * resposta é nada.
 */

import type { AlertSeverity } from "../engine/rules/detection-rules.js";

/** Valor gravado quando o alerta não tinha para onde ir. */
export const CANAL_NENHUM = "nenhum";

/** Quais canais existem neste processo, no momento do alerta. */
export interface CanaisConfigurados {
  /** Web Push ativo (VAPID configurado) */
  push: boolean;
  /** Ligação ativa (Twilio configurado) */
  voice: boolean;
  /** E-mail ativo (SMTP configurado) */
  email: boolean;
}

/**
 * O canal (ou canais) que o registro deve declarar para um alerta desta
 * severidade. `critical` vai por push e/ou ligação; `normal` por e-mail.
 * Nunca inventa um canal que não existe.
 */
export function canalDoRegistro(severity: AlertSeverity, canais: CanaisConfigurados): string {
  if (severity === "critical") {
    const ativos = [canais.push ? "push" : null, canais.voice ? "voice" : null].filter(
      (c): c is string => c !== null,
    );
    return ativos.length > 0 ? ativos.join("+") : CANAL_NENHUM;
  }
  return canais.email ? "email" : CANAL_NENHUM;
}
