/**
 * Suíte de conformidade reutilizável para adaptadores de rede.
 *
 * Um colaborador que escreve o adaptador de uma rede nova não deveria ter que
 * adivinhar o que o núcleo espera dele, nem descobrir em produção que
 * esqueceu de propagar um erro. Este arquivo transforma o contrato de
 * `chain-adapter.ts` em testes executáveis: o adaptador novo declara um
 * `ConformanceSubject` e ganha a bateria inteira de uma vez.
 *
 * Como usar (ver adapter-conformance.test.ts pra exemplos reais, e
 * docs/DEVELOPING_ADAPTERS.md pro passo a passo):
 *
 * ```ts
 * import { describeAdapterConformance } from "./adapter-conformance.js";
 *
 * describeAdapterConformance({
 *   label: "MinhaRedeAdapter",
 *   sampleAddress: "0x...",
 *   expectedBalance: 1_000n,
 *   create: () => new MinhaRedeAdapterFalso(),
 *   createFailing: () => new MinhaRedeAdapterQueSempreFalha(),
 * });
 * ```
 *
 * Nenhum teste daqui toca a rede. O `subject` fornece adaptadores com
 * fixtures determinísticas - é obrigação de quem integra construí-los, e é
 * essa obrigação que garante que o adaptador seja testável sem credencial,
 * sem endpoint privado e sem rede (ver CONTRIBUTING.md).
 *
 * O que esta suíte NÃO cobre, e por quê: correção da decodificação dos
 * eventos da rede. Isso é específico de cada protocolo e não dá pra verificar
 * genericamente - cada adaptador precisa dos seus próprios testes de
 * decodificação, com fixtures de log reais (ver tempo.adapter.test.ts como
 * exemplo). A conformidade aqui é sobre o CONTRATO, não sobre a semântica da
 * rede.
 */

import { describe, expect, it } from "vitest";
import type { ChainAddress, MonitoredChainAdapter } from "./chain-adapter.js";

export interface ConformanceSubject {
  /** nome que aparece na saída do teste */
  label: string;
  /**
   * Endereço VÁLIDO na notação desta rede - 0x hex no EVM, base58 numa rede
   * SVM. Nunca é usado em rede. Deixou de ser o `Address` da viem em
   * 23/10/2026: tipar como `0x${string}` aqui obrigava toda rede a parecer
   * EVM só pra rodar a suíte.
   */
  sampleAddress: ChainAddress;
  /**
   * Texto que NÃO é endereço válido nesta rede, pra verificar que a validação
   * recusa. Obrigatório pelo mesmo motivo que `createFailing`: sem um exemplo
   * negativo, uma validação que aceita tudo passaria na suíte inteira.
   */
  invalidAddress: string;
  /** saldo que `create()` deve devolver, pra conferir que o número chega intacto ao núcleo */
  expectedBalance: bigint;
  /** adaptador com fixtures determinísticas, que responde sem tocar rede */
  create(): MonitoredChainAdapter;
  /**
   * Adaptador cujo acesso à rede SEMPRE falha (timeout, resposta inválida,
   * RPC fora do ar). Obrigatório, não opcional: a propriedade mais importante
   * desta suíte é provar que a falha PROPAGA em vez de virar um saldo falso,
   * e sem este construtor não há como verificar isso.
   */
  createFailing(): MonitoredChainAdapter;
}

/**
 * Bateria de validação de endereço.
 *
 * Existe porque, até 23/10/2026, o produto validava endereço com o `isAddress`
 * da viem direto em `server.ts`. Um adaptador não-EVM perfeito, aprovado por
 * toda esta suíte, continuaria inutilizável: não havia onde digitar um
 * endereço que não fosse 0x. A validação virou parte do contrato, e estes
 * testes são o que impede que ela volte a ser decorativa.
 */
function describeAddressChecking(subject: ConformanceSubject): void {
  describe("validação de endereço", () => {
    it("aceita um endereço válido da própria rede", () => {
      const result = subject.create().checkAddress(subject.sampleAddress);
      expect(result.ok).toBe(true);
    });

    it("recusa um endereço inválido, e diz por quê - a frase vai pra tela de quem digitou", () => {
      const result = subject.create().checkAddress(subject.invalidAddress);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason.trim().length).toBeGreaterThan(0);
    });

    it("recusa texto vazio", () => {
      expect(subject.create().checkAddress("").ok).toBe(false);
    });

    it("a forma normalizada é ela mesma válida - normalizar duas vezes dá o mesmo resultado", () => {
      /*
       * Pega um erro real e silencioso: uma normalização que produz algo que a
       * própria validação recusaria. Aconteceria, por exemplo, num adaptador
       * EVM que valida exigindo checksum EIP-55 mas normaliza pra minúsculo.
       * Sem este teste, o endereço entraria no banco numa forma que nenhuma
       * revalidação posterior aceita.
       */
      const adapter = subject.create();
      const primeira = adapter.checkAddress(subject.sampleAddress);
      expect(primeira.ok).toBe(true);
      if (!primeira.ok) return;

      const segunda = adapter.checkAddress(primeira.normalized);
      expect(segunda.ok).toBe(true);
      if (!segunda.ok) return;
      expect(segunda.normalized).toBe(primeira.normalized);
    });

    it("valida SEM tocar a rede - funciona até no adaptador cujo RPC sempre falha", () => {
      /*
       * A propriedade que mais importa aqui. Se a validação consultasse a
       * rede, um RPC fora do ar passaria a impedir o dono de CADASTRAR a conta
       * que ele quer vigiar - justo quando ele mais quer vigiá-la. O adaptador
       * de `createFailing()` tem a rede morta por construção, então ele passar
       * neste teste é a prova de que nenhuma consulta acontece.
       */
      const falho = subject.createFailing();
      expect(falho.checkAddress(subject.sampleAddress).ok).toBe(true);
      expect(falho.checkAddress(subject.invalidAddress).ok).toBe(false);
    });

    it("é síncrono - validação de formulário não pode devolver Promise", () => {
      // Um autor de adaptador que declara `async checkAddress` ainda compila
      // (Promise é objeto), e aí `result.ok` seria `undefined`, que é falsy:
      // TODO endereço seria recusado, inclusive os válidos.
      const result: unknown = subject.create().checkAddress(subject.sampleAddress);
      expect(result).not.toBeInstanceOf(Promise);
    });
  });
}

/** Nomes de propriedade que denunciariam material de assinatura num adaptador de LEITURA. */
const SIGNING_MATERIAL_PATTERN = /privatekey|mnemonic|seedphrase|secretkey|signer|wallet|keystore/i;

export function describeAdapterConformance(subject: ConformanceSubject): void {
  describe(`conformidade de adaptador: ${subject.label}`, () => {
    describe("metadados", () => {
      it("declara chainKey e displayName não vazios", () => {
        const { metadata } = subject.create();
        expect(metadata.chainKey.length).toBeGreaterThan(0);
        expect(metadata.displayName.length).toBeGreaterThan(0);
      });

      it("declara a família da rede - é o que diz a um revisor se o núcleo EVM dá pra reaproveitar", () => {
        const { metadata } = subject.create();
        expect(["evm", "svm", "other"]).toContain(metadata.family);
      });

      it("só declara chainId numérico se a família tiver esse conceito (não inventa número pra preencher campo)", () => {
        const { metadata } = subject.create();
        if (metadata.family !== "evm") return;
        expect(typeof metadata.chainId).toBe("number");
      });
    });

    describeAddressChecking(subject);

    describe("capacidades declaradas", () => {
      it("declara pelo menos uma forma de ler saldo - um adaptador que não lê saldo nenhum não monitora nada", () => {
        const { capabilities } = subject.create();
        expect(capabilities.tokenBalance || capabilities.nativeBalance).toBe(true);
      });

      it("se exige endereço de token, então sabe ler saldo de token (combinação incoerente não passa)", () => {
        const { capabilities } = subject.create();
        if (!capabilities.requiresTokenAddress) return;
        expect(capabilities.tokenBalance).toBe(true);
      });

      it("maxHistoryWindow é positivo - zero travaria o monitor em qualquer gap de cursor", () => {
        expect(subject.create().maxHistoryWindow).toBeGreaterThan(0n);
      });
    });

    describe("getBalance", () => {
      it("devolve o saldo na menor unidade, como bigint, intacto", async () => {
        const snapshot = await subject.create().getBalance(subject.sampleAddress);
        expect(snapshot.raw).toBe(subject.expectedBalance);
        expect(typeof snapshot.raw).toBe("bigint");
      });

      it("ecoa o endereço consultado - o núcleo usa isso pra saber de qual conta é o snapshot", async () => {
        const snapshot = await subject.create().getBalance(subject.sampleAddress);
        expect(snapshot.address).toBe(subject.sampleAddress);
      });

      it("marca observedAt com a hora local da leitura, não um timestamp da rede", async () => {
        const before = Date.now();
        const snapshot = await subject.create().getBalance(subject.sampleAddress);
        const after = Date.now();

        expect(snapshot.observedAt).toBeInstanceOf(Date);
        expect(snapshot.observedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(snapshot.observedAt.getTime()).toBeLessThanOrEqual(after);
      });

      it("devolve o cursor da rede como bigint", async () => {
        const snapshot = await subject.create().getBalance(subject.sampleAddress);
        expect(typeof snapshot.blockNumber).toBe("bigint");
      });

      /**
       * O teste mais importante da suíte inteira.
       *
       * Um adaptador que engole a falha de RPC e devolve `0n` faz o núcleo
       * enxergar "saldo foi a zero" - ou seja, uma queda de 100% - e, pior,
       * faz a ausência de leitura parecer ausência de movimento. Em qualquer
       * um dos dois casos o usuário fica sem a proteção que acredita ter.
       * Falhar alto é a única opção correta: o monitor já trata erro de ciclo
       * (loga, conta falha consecutiva, chama onUnhealthy) - ele só não tem
       * como tratar o que nunca foi reportado como erro.
       */
      it("PROPAGA a falha de rede em vez de devolver 0n ou um saldo inventado", async () => {
        await expect(subject.createFailing().getBalance(subject.sampleAddress)).rejects.toThrow();
      });
    });

    describe("getConfirmedBlockNumber", () => {
      it("nunca devolve cursor negativo, mesmo com profundidade de confirmação maior que a altura da cadeia", async () => {
        expect(await subject.create().getConfirmedBlockNumber()).toBeGreaterThanOrEqual(0n);
      });

      it("propaga falha de rede em vez de devolver um cursor inventado", async () => {
        await expect(subject.createFailing().getConfirmedBlockNumber()).rejects.toThrow();
      });
    });

    describe("getFeeAdjustment", () => {
      it("nunca devolve valor negativo - o núcleo SOMA isto ao saldo antes de comparar, e um negativo viraria queda falsa", async () => {
        const adapter = subject.create();
        const adjustment = await adapter.getFeeAdjustment(1n, 100n, subject.sampleAddress);
        expect(adjustment).toBeGreaterThanOrEqual(0n);
      });

      it("intervalo vazio ou invertido não produz ajuste", async () => {
        const adapter = subject.create();
        expect(await adapter.getFeeAdjustment(100n, 100n, subject.sampleAddress)).toBe(0n);
        expect(await adapter.getFeeAdjustment(100n, 50n, subject.sampleAddress)).toBe(0n);
      });

      it("devolve exatamente 0n quando declara que a taxa NÃO sai do ativo monitorado", async () => {
        const adapter = subject.create();
        if (adapter.capabilities.feePaidInMonitoredAsset) return;
        expect(await adapter.getFeeAdjustment(1n, 100n, subject.sampleAddress)).toBe(0n);
      });

      it("é idempotente no mesmo intervalo - duas leituras do mesmo range dão o mesmo ajuste", async () => {
        const adapter = subject.create();
        const first = await adapter.getFeeAdjustment(1n, 100n, subject.sampleAddress);
        const second = await adapter.getFeeAdjustment(1n, 100n, subject.sampleAddress);
        expect(second).toBe(first);
      });
    });

    describe("isolamento de credenciais", () => {
      /**
       * Adaptador é componente de LEITURA. Nenhum deles tem motivo pra
       * conhecer chave privada, mnemônico ou signer - e, como adaptadores são
       * exatamente a parte do projeto que a comunidade vai escrever, este
       * limite precisa ser verificado por teste e não só pedido na
       * documentação. Ver SECURITY.md e docs/ADAPTER_SPEC.md.
       *
       * A checagem é estrutural (nomes de propriedade), então não é uma
       * prova: um adaptador malicioso consegue escondê-la. O que ela pega é o
       * caso realista - alguém que, de boa-fé, guarda um signer no adaptador
       * porque "ia precisar depois". Pra o caso malicioso o controle é a
       * revisão humana obrigatória de todo adaptador (ver CONTRIBUTING.md).
       */
      it("não expõe propriedade com cara de material de assinatura", () => {
        const adapter = subject.create() as unknown as Record<string, unknown>;
        const names = new Set<string>();
        for (
          let current: object | null = adapter;
          current && current !== Object.prototype;
          current = Object.getPrototypeOf(current) as object | null
        ) {
          for (const name of Object.getOwnPropertyNames(current)) names.add(name);
        }

        const suspicious = [...names].filter((name) => SIGNING_MATERIAL_PATTERN.test(name));
        expect(suspicious).toEqual([]);
      });

      it("não implementa caminho de escrita na cadeia (sendTransaction/signMessage e afins)", () => {
        const adapter = subject.create() as unknown as Record<string, unknown>;
        for (const forbidden of ["sendTransaction", "signMessage", "signTypedData", "writeContract"]) {
          expect(typeof adapter[forbidden]).not.toBe("function");
        }
      });
    });
  });
}
