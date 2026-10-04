import { describe, expect, it } from "vitest";
import { buildOtpAuthUri, generateBase32Secret } from "./totp.js";
import { renderOtpQrSvg } from "./otp-qr.js";

describe("renderOtpQrSvg", () => {
  it("gera um SVG válido a partir da URI otpauth://", async () => {
    const uri = buildOtpAuthUri({ secret: generateBase32Secret(), accountName: "teste", issuer: "VILIGION" });

    const svg = await renderOtpQrSvg(uri);

    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});
