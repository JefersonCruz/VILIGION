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
