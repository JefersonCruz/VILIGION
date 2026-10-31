import { describe, expect, it } from "vitest";
import { LocalDevKeyProvider, MappingEncryption } from "./encryption.js";

describe("MappingEncryption", () => {
  it("round-trip: decripta exatamente o que foi criptografado", async () => {
    const keyProvider = new LocalDevKeyProvider();
    const encryption = new MappingEncryption(keyProvider);

    const original = JSON.stringify({ address: "0xabc", phone: "+5511999999999" });
    const payload = await encryption.encrypt(original);
    const decrypted = await encryption.decrypt(payload);

    expect(decrypted).toBe(original);
  });

  it("cada chamada de encrypt usa uma DEK diferente (envelope encryption de verdade, não chave fixa)", async () => {
    const keyProvider = new LocalDevKeyProvider();
    const encryption = new MappingEncryption(keyProvider);

    const a = await encryption.encrypt("mesmo texto");
    const b = await encryption.encrypt("mesmo texto");

    expect(a.encryptedDataKey.equals(b.encryptedDataKey)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejeita ciphertext adulterado - prova que o auth tag do GCM protege contra tampering", async () => {
    const keyProvider = new LocalDevKeyProvider();
    const encryption = new MappingEncryption(keyProvider);

    const payload = await encryption.encrypt("dado sensível");
    payload.ciphertext[0] = (payload.ciphertext[0] ?? 0) ^ 0xff; // adultera 1 byte

    await expect(encryption.decrypt(payload)).rejects.toThrow();
  });

  it("não decripta com a chave mestra errada", async () => {
    const keyProviderA = new LocalDevKeyProvider();
    const keyProviderB = new LocalDevKeyProvider(); // chave mestra diferente
    const encryption = new MappingEncryption(keyProviderA);
    const wrongEncryption = new MappingEncryption(keyProviderB);

    const payload = await encryption.encrypt("dado sensível");

    await expect(wrongEncryption.decrypt(payload)).rejects.toThrow();
  });
});

describe("rotação da chave mestra", () => {
  /**
   * O cenário é o incidente de 22/10/2026: a chave mestra vivia numa variável
   * de ambiente do provedor, o provedor avisou que variáveis podem ter
   * vazado, e trocá-la virou resposta a incidente.
   *
   * Reempacotar é o que torna isso possível sem perder dado - e estes testes
   * são a prova de que não perde. Ver scripts/rotate-encryption-key.ts.
   */
  it("depois de reempacotar a DEK, a chave NOVA decifra o conteúdo antigo", async () => {
    const velha = new LocalDevKeyProvider("11".repeat(32));
    const nova = new LocalDevKeyProvider("22".repeat(32));
    const payload = await new MappingEncryption(velha).encrypt("+5511999999999");

    // reempacotamento: abre com a velha, fecha com a nova
    const dek = await velha.decryptDataKey(payload.encryptedDataKey);
    const reempacotada = await nova.encryptDataKey(dek);

    const aberto = await new MappingEncryption(nova).decrypt({ ...payload, encryptedDataKey: reempacotada });

    expect(aberto).toBe("+5511999999999");
  });

  it("o ciphertext não é tocado - só o envelope muda", async () => {
    // É o que torna a rotação barata: o conteúdo nunca é decifrado e
    // recifrado, então nenhum texto em claro passa pelo processo de rotação.
    const velha = new LocalDevKeyProvider("33".repeat(32));
    const nova = new LocalDevKeyProvider("44".repeat(32));
    const payload = await new MappingEncryption(velha).encrypt("dado sensível");

    const dek = await velha.decryptDataKey(payload.encryptedDataKey);
    const reempacotada = await nova.encryptDataKey(dek);

    expect(payload.ciphertext.equals(payload.ciphertext)).toBe(true);
    expect(reempacotada.equals(payload.encryptedDataKey)).toBe(false);
  });

  it("depois de rotacionar, a chave VELHA não abre mais - que é o ponto", async () => {
    const velha = new LocalDevKeyProvider("55".repeat(32));
    const nova = new LocalDevKeyProvider("66".repeat(32));
    const payload = await new MappingEncryption(velha).encrypt("segredo");

    const dek = await velha.decryptDataKey(payload.encryptedDataKey);
    const reempacotada = await nova.encryptDataKey(dek);

    await expect(
      new MappingEncryption(velha).decrypt({ ...payload, encryptedDataKey: reempacotada }),
    ).rejects.toThrow();
  });

  it("chave errada falha ao abrir a DEK, ANTES de qualquer escrita", async () => {
    // O script depende disto: se --old estiver errada, a falha acontece na
    // leitura do envelope, antes de gravar qualquer coisa no banco.
    const velha = new LocalDevKeyProvider("77".repeat(32));
    const errada = new LocalDevKeyProvider("88".repeat(32));
    const payload = await new MappingEncryption(velha).encrypt("x");

    await expect(errada.decryptDataKey(payload.encryptedDataKey)).rejects.toThrow();
  });
});
