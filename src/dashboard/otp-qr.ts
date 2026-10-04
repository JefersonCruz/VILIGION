/**
 * Renderiza o QR code de setup do TOTP como SVG, gerado inteiramente no
 * servidor (biblioteca `qrcode` roda local, sem rede) - o segredo nunca sai
 * pra um serviço terceiro de geração de QR, só pra não abrir uma exposição
 * nova além da própria URI `otpauth://` já mostrada como texto.
 */

import QRCode from "qrcode";

export async function renderOtpQrSvg(otpAuthUri: string): Promise<string> {
  return QRCode.toString(otpAuthUri, {
    type: "svg",
    margin: 1,
    color: { dark: "#0b0f19", light: "#e5e7eb" },
  });
}
