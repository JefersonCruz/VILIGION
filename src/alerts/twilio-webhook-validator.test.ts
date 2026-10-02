import twilio from "twilio";
import { describe, expect, it } from "vitest";
import { assertValidTwilioWebhook, isValidTwilioWebhook } from "./twilio-webhook-validator.js";

describe("twilio-webhook-validator", () => {
  const authToken = "test-auth-token-not-real";
  const fullUrl = "https://example.com/webhooks/twilio/gather?alertId=abc";
  const params = { Digits: "1234", CallSid: "CAxxxxx" };

  it("aceita assinatura válida gerada com o mesmo auth token", () => {
    const signature = twilio.getExpectedTwilioSignature(authToken, fullUrl, params);

    expect(
      isValidTwilioWebhook({ authToken, fullUrl, signatureHeader: signature, params }),
    ).toBe(true);
  });

  it("rejeita quando o header de assinatura está ausente", () => {
    expect(
      isValidTwilioWebhook({ authToken, fullUrl, signatureHeader: undefined, params }),
    ).toBe(false);
  });

  it("rejeita assinatura forjada/incorreta - é exatamente o cenário que permitiria forjar confirmação de PIN", () => {
    expect(
      isValidTwilioWebhook({
        authToken,
        fullUrl,
        signatureHeader: "assinatura-forjada-qualquer",
        params,
      }),
    ).toBe(false);
  });

  it("assertValidTwilioWebhook lança erro quando a assinatura é inválida", () => {
    expect(() =>
      assertValidTwilioWebhook({
        authToken,
        fullUrl,
        signatureHeader: undefined,
        params,
      }),
    ).toThrow();
  });

  it("assertValidTwilioWebhook não lança erro quando a assinatura é válida", () => {
    const signature = twilio.getExpectedTwilioSignature(authToken, fullUrl, params);

    expect(() =>
      assertValidTwilioWebhook({ authToken, fullUrl, signatureHeader: signature, params }),
    ).not.toThrow();
  });
});
