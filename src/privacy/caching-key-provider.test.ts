import { describe, expect, it } from "vitest";
import { CachingKeyProvider } from "./caching-key-provider.js";
import { LocalDevKeyProvider, MappingEncryption, type KeyProvider } from "./encryption.js";

/** Provider que conta chamadas - fica no lugar do KMS, que é o que custaria caro de verdade. */
class ProviderContado implements KeyProvider {
  desempacotamentos = 0;
  geracoes = 0;
  falharProximo = false;

  constructor(private readonly inner: KeyProvider = new LocalDevKeyProvider("ab".repeat(32))) {}

  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: Buffer }> {
    this.geracoes++;
    return this.inner.generateDataKey();
  }

  async encryptDataKey(k: Buffer): Promise<Buffer> {
    return this.inner.encryptDataKey(k);
  }

  async decryptDataKey(k: Buffer): Promise<Buffer> {
    this.desempacotamentos++;
    if (this.falharProximo) {
      this.falharProximo = false;
      throw new Error("KMS indisponível");
    }
    return this.inner.decryptDataKey(k);
  }
}

describe("CachingKeyProvider", () => {
  it("desempacota uma vez e reaproveita - é o ponto: tirar o KMS do caminho do alerta", async () => {
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado);
    const payload = await new MappingEncryption(contado).encrypt("+5511999999999");

    const cifra = new MappingEncryption(cache);
    await cifra.decrypt(payload);
    await cifra.decrypt(payload);
    await cifra.decrypt(payload);

    expect(contado.desempacotamentos).toBe(1);
  });

  it("devolve o conteúdo certo, servido do cache", async () => {
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado);
    const payload = await new MappingEncryption(contado).encrypt("+5511999999999");
    const cifra = new MappingEncryption(cache);

    await cifra.decrypt(payload);

    expect(await cifra.decrypt(payload)).toBe("+5511999999999");
  });

  it("registros diferentes não compartilham chave", async () => {
    // Cada registro tem a sua DEK; confundi-las seria desfazer o motivo de a
    // cifragem ser por envelope.
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado);
    const base = new MappingEncryption(contado);
    const a = await base.encrypt("primeiro");
    const b = await base.encrypt("segundo");

    const cifra = new MappingEncryption(cache);

    expect(await cifra.decrypt(a)).toBe("primeiro");
    expect(await cifra.decrypt(b)).toBe("segundo");
    expect(contado.desempacotamentos).toBe(2);
  });

  it("expira pelo TTL - limita quanto tempo material de chave fica em memória", async () => {
    let agora = 1_000;
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado, { ttlMs: 60_000, now: () => agora });
    const payload = await new MappingEncryption(contado).encrypt("x");
    const cifra = new MappingEncryption(cache);

    await cifra.decrypt(payload);
    agora += 60_001;
    await cifra.decrypt(payload);

    expect(contado.desempacotamentos).toBe(2);
  });

  it("NÃO cacheia falha - um KMS fora do ar não pode virar falha fixa no caminho do alerta", async () => {
    /**
     * O teste que mais importa aqui. Memorizar o erro faria uma
     * indisponibilidade de segundos virar uma falha de TODO o TTL - e é no
     * caminho do alerta, então o dono deixaria de ser avisado por minutos
     * por causa de uma falha que já passou.
     */
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado);
    const payload = await new MappingEncryption(contado).encrypt("+5511999999999");
    const cifra = new MappingEncryption(cache);

    contado.falharProximo = true;
    await expect(cifra.decrypt(payload)).rejects.toThrow("KMS indisponível");

    // a tentativa seguinte funciona, em vez de herdar o erro
    expect(await cifra.decrypt(payload)).toBe("+5511999999999");
  });

  it("gerar DEK nova nunca é cacheado - duas chamadas dão chaves diferentes", async () => {
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado);

    const a = await cache.generateDataKey();
    const b = await cache.generateDataKey();

    expect(a.plaintextKey.equals(b.plaintextKey)).toBe(false);
    expect(contado.geracoes).toBe(2);
  });

  it("quem chama pode zerar o buffer sem corromper o cache", async () => {
    // MappingEncryption.decrypt faz `plaintextKey.fill(0)` depois de usar. Se
    // o cache devolvesse a sua própria instância, a segunda leitura abriria
    // com uma chave zerada.
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado);
    const payload = await new MappingEncryption(contado).encrypt("conteúdo");
    const cifra = new MappingEncryption(cache);

    await cifra.decrypt(payload);

    expect(await cifra.decrypt(payload)).toBe("conteúdo");
  });

  it("limita o número de entradas - não vaza memória num processo que roda sem parar", async () => {
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado, { maxEntries: 3 });
    const base = new MappingEncryption(contado);
    const cifra = new MappingEncryption(cache);

    for (let i = 0; i < 10; i++) await cifra.decrypt(await base.encrypt(`v${i}`));

    expect(cache.stats().entradas).toBeLessThanOrEqual(3);
  });

  it("clear() descarta tudo - para usar depois de rotacionar a chave mestra", async () => {
    const contado = new ProviderContado();
    const cache = new CachingKeyProvider(contado);
    const payload = await new MappingEncryption(contado).encrypt("x");
    const cifra = new MappingEncryption(cache);

    await cifra.decrypt(payload);
    cache.clear();
    await cifra.decrypt(payload);

    expect(contado.desempacotamentos).toBe(2);
    expect(cache.stats().entradas).toBe(1);
  });

  it("stats() não expõe material de chave", () => {
    const stats = new CachingKeyProvider(new ProviderContado()).stats();

    expect(Object.keys(stats).sort()).toEqual(["acertos", "entradas", "erros"]);
  });
});
