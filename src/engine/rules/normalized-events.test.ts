import { describe, expect, it } from "vitest";
import { observationKey, type NormalizedObservation } from "./normalized-events.js";

describe("observationKey", () => {
  it("usa a sequência quando a rede fornece uma - é o identificador mais forte", () => {
    const key = observationKey({
      kind: "transfer-restricted",
      chainKey: "tempo",
      cursor: 100n,
      sequence: 7n,
      amount: 1n,
    });

    expect(key).toBe("tempo:transfer-restricted:seq:7");
  });

  it("a mesma ocorrência vista em cursores diferentes (reorg) dá a MESMA chave", () => {
    // É o ponto da desduplicação: numa reorg o mesmo bloqueio reaparece em
    // outro bloco. Se o cursor entrasse na chave, o dono receberia dois
    // alertas pela mesma ocorrência.
    const base = { kind: "transfer-restricted", chainKey: "tempo", sequence: 7n, amount: 1n } as const;

    expect(observationKey({ ...base, cursor: 100n })).toBe(observationKey({ ...base, cursor: 118n }));
  });

  it("ocorrências distintas na mesma rede dão chaves distintas", () => {
    const base = { kind: "transfer-restricted", chainKey: "tempo", cursor: 100n, amount: 1n } as const;

    expect(observationKey({ ...base, sequence: 7n })).not.toBe(observationKey({ ...base, sequence: 8n }));
  });

  it("a mesma sequência em redes diferentes dá chaves diferentes - nonce não é global", () => {
    const base = { kind: "transfer-restricted", cursor: 1n, sequence: 7n, amount: 1n } as const;

    expect(observationKey({ ...base, chainKey: "tempo" })).not.toBe(
      observationKey({ ...base, chainKey: "outra-rede" }),
    );
  });

  it("tipos diferentes com a mesma sequência não colidem", () => {
    const restricted: NormalizedObservation = {
      kind: "transfer-restricted",
      chainKey: "x",
      cursor: 1n,
      sequence: 5n,
      amount: 1n,
    };
    const authority: NormalizedObservation = {
      kind: "authority-change",
      chainKey: "x",
      cursor: 1n,
      sequence: 5n,
      authorityKind: "owner",
    };

    expect(observationKey(restricted)).not.toBe(observationKey(authority));
  });

  it("sem sequência, cai na referência de transação + cursor", () => {
    const key = observationKey({
      kind: "authority-change",
      chainKey: "rede-x",
      cursor: 42n,
      txRef: "0xabc",
      authorityKind: "owner",
    });

    expect(key).toBe("rede-x:authority-change:tx:0xabc:42");
  });

  it("sem sequência NEM referência de transação, devolve null em vez de inventar uma chave", () => {
    /**
     * A parte que importa deste teste é o `null`.
     *
     * A alternativa tentadora - montar a chave só com `chainKey:kind:cursor` -
     * desduplicaria eventos DISTINTOS que caíssem no mesmo cursor, ou seja,
     * engoliria alerta de verdade. Devolver null declara "esta observação não
     * é desduplicável" e empurra a decisão pro chamador, que é o único que
     * sabe se o certo ali é repetir ou descartar. Ver normalized-events.ts.
     */
    const key = observationKey({
      kind: "balance-change",
      chainKey: "rede-x",
      cursor: 42n,
      amount: 5n,
      direction: "out",
    });

    expect(key).toBeNull();
  });
});
