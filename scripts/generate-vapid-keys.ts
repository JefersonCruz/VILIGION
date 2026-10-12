/**
 * Gera o par de chaves VAPID do canal de alerta por push (ver
 * src/alerts/web-push.ts). Rode uma vez e guarde o resultado nas variáveis
 * de ambiente - NÃO comite a chave privada.
 *
 *   npx tsx scripts/generate-vapid-keys.ts
 *
 * Trocar o par depois força todos os dispositivos já inscritos a se
 * inscreverem de novo (a inscrição no navegador é amarrada à chave pública),
 * então rotação não é de graça: o usuário tem que clicar em "Registrar este
 * dispositivo" outra vez. Gere uma vez por ambiente e mantenha.
 */

import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log("Chaves VAPID geradas. Configure no ambiente (Railway / .env):\n");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=https://seu-dominio.com");
console.log("\nA chave PÚBLICA pode ir pro front (é servida em /push/config).");
console.log("A chave PRIVADA é segredo - trate igual TWILIO_AUTH_TOKEN.");
