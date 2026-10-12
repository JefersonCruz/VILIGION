/**
 * Gera os icones de PWA e o badge de notificacao a partir da arte em alta
 * resolucao. Rode so quando a marca mudar - os PNGs resultantes sao
 * versionados em assets/, entao o uso normal do projeto nao precisa disto.
 *
 *   npm i -D sharp && node scripts/generate-icons.mjs && npm uninstall sharp
 *
 * sharp NAO fica no package.json de proposito: e dependencia nativa pesada,
 * usada uma vez a cada troca de marca, e deixa-la instalada so faria o CI
 * baixar binario a cada rodada.
 *
 * Duas decisoes de desenho que o codigo sozinho nao explica:
 *
 * 1. Recorta a marca "V" SOZINHA, nao o lockup. A arte de origem tem o "V"
 *    sobre a palavra "VILIGION"; a ~48px de uma notificacao, a palavra vira
 *    borrao ilegivel. A caixa do "V" foi medida por luminancia na origem.
 *
 * 2. O "V" ocupa 62% do quadrado. E a zona segura de icone adaptativo do
 *    Android: a mascara do aparelho corta ate ~33% da borda, entao um icone
 *    que usa a largura toda perde a marca. E o que permite declarar
 *    "maskable" no manifest com honestidade.
 *
 * O badge e silhueta BRANCA sobre transparente porque o Android o mascara
 * pelo canal alpha - um PNG opaco viraria um quadrado solido na barra de
 * status. A luminancia da arte vira o alpha.
 */

import sharp from "sharp";

const SRC = "docs/assets/logo-ful.png";
/** Caixa do "V" na arte de origem (1254x1254), medida por luminancia + folga. */
const V_BOX = { left: 379, top: 339, width: 477, height: 359 };
/** Fundo real da arte - casar evita emenda visivel do retangulo extraido. */
const BG = { r: 1, g: 1, b: 3 };
const SAFE = 0.62;

async function icon(size, file) {
  const inner = Math.round(size * SAFE);
  const height = Math.round((inner * V_BOX.height) / V_BOX.width);
  const mark = await sharp(SRC).extract(V_BOX).resize(inner, height, { kernel: "lanczos3" }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: BG } })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(file, size + "x" + size);
}

async function badge(size, file) {
  const inner = Math.round(size * 0.78);
  const height = Math.round((inner * V_BOX.height) / V_BOX.width);
  const { data } = await sharp(SRC).extract(V_BOX).resize(inner, height, { kernel: "lanczos3" })
    .greyscale().raw().toBuffer({ resolveWithObject: true });

  const rgba = Buffer.alloc(inner * height * 4);
  for (let i = 0; i < inner * height; i++) {
    const lum = data[i];
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = lum < 30 ? 0 : Math.min(255, Math.round(lum * 1.7));
  }

  const silhouette = await sharp(rgba, { raw: { width: inner, height, channels: 4 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: silhouette, gravity: "centre" }])
    .png()
    .toFile(file);
  console.log(file, size + "x" + size, "(silhueta com alpha)");
}

await icon(192, "assets/icon-192.png");
await icon(512, "assets/icon-512.png");
await badge(96, "assets/badge-96.png");
