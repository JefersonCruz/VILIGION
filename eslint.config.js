// @ts-check
/**
 * Configuração do ESLint.
 *
 * Princípio: este linter procura BUG, não estilo.
 *
 * Nenhuma regra estilística está ligada — nada de aspas, ponto e vírgula,
 * largura de linha ou ordem de import. O código deste repositório foi escrito
 * à mão com estilo consistente, e um linter que reclama de formatação em 40
 * arquivos no primeiro dia produz um PR gigante de ruído que esconde qualquer
 * achado real. Se o time quiser formatação automática um dia, isso é trabalho
 * de um formatador (Prettier), não daqui.
 *
 * O que está ligado são as regras COM TIPO (`recommended-type-checked`), que
 * precisam do compilador e por isso acham o que nenhuma análise sintática
 * acha. Duas delas pagam sozinhas o custo de rodar o typechecker de novo:
 *
 * - `no-misused-promises`: achou um caminho real de queda do PROCESSO neste
 *   projeto — `createServer(async ...)` em index.ts e webhook-server.ts fazia
 *   a rejeição não tratada encerrar o processo que roda todos os monitores de
 *   tesouraria. Ver async-request-handler.ts. Nenhuma revisão humana olha
 *   `createServer(async ...)` e vê um processo morrendo.
 * - `no-floating-promises`: a mesma família. Uma Promise não aguardada no
 *   caminho do alerta é um alerta que o processo acha que mandou e não
 *   mandou. Some num `await` esquecido no meio de uma função de 20 linhas.
 *
 * Para rodar: `npm run lint`.
 */

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Saída de build e dependências: código gerado ou de terceiro, não é
    // nosso pra consertar. `dist/` em particular é cópia compilada de `src/`,
    // então lintá-lo duplicaria todo achado.
    ignores: ["dist/**", "node_modules/**", "coverage/**", "preview-landing.html"],
  },

  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /*
       * ───────────────── A trava que importa (erro) ─────────────────
       *
       * Estas duas ficam como ERRO e barram o CI. Nao e preferencia: a
       * primeira achou um caminho real de queda do PROCESSO neste
       * repositorio - `createServer(async ...)` fazia a rejeicao nao tratada
       * encerrar o processo que roda todos os monitores de tesouraria (ver
       * async-request-handler.ts). Vem ligada do `recommended-type-checked`;
       * esta linha existe pra deixar explicito que e deliberado.
       */
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      /*
       * ──────── Desligadas, cada uma com a contagem medida ────────
       *
       * Nenhuma foi desligada por conveniencia. Cada linha tem o numero real
       * de ocorrencias da primeira execucao e a razao de aquilo nao ser bug.
       */

      /*
       * 82 ocorrencias - de longe a mais ruidosa, e nenhuma e bug.
       *
       * Registro porque a primeira versao desta configuracao afirmava o
       * contrario: eu havia escrito que `require-await` valia o custo. A
       * execucao mostrou que nao. Quase toda ocorrencia e um fake de teste
       * implementando contrato assincrono:
       *
       *     async getBalance(address) { return { ...fixture }; }
       *
       * O `async` ali e OBRIGATORIO pra cumprir a assinatura de
       * `MonitoredChainAdapter`; nao ter `await` dentro e a consequencia
       * normal de devolver valor pre-programado em vez de ler a rede. Exigir
       * `await` onde nao ha nada pra esperar empurraria o autor a escrever
       * `await Promise.resolve(x)`, que e pior que o problema.
       */
      "@typescript-eslint/require-await": "off",

      // O projeto trata erro desconhecido via `describeError`/`String(err)` e
      // interpola valores em log e em HTML (com escape proprio - ver
      // `escapeHtml` em views.ts). A regra marcaria cada interpolacao
      // legitima dessas.
      "@typescript-eslint/restrict-template-expressions": "off",

      // `catch {}` vazio e usado de proposito onde o comentario explica o
      // porque (ex: log que nao e o evento esperado, em tempo.adapter.ts). A
      // decisao de engolir esta documentada caso a caso; a regra nao le
      // comentario.
      "@typescript-eslint/no-empty-function": "off",

      /*
       * ─────────────────── Ratchet (aviso) ───────────────────
       *
       * Estas apontam coisa legitima, mas nao bug, e nao barram o CI HOJE por
       * um motivo so: as ocorrencias estao em codigo preexistente, parte dele
       * em arquivo com trabalho em andamento em outra branch. Corrigi-las
       * aqui significaria ou mexer na mudanca de outra pessoa, ou um PR
       * gigante de limpeza mecanica que esconderia o que este PR faz.
       *
       * Aviso aparece na saida e nao e esquecido. A intencao e subir cada uma
       * pra "error" num PR proprio, pequeno, depois que o trabalho em
       * andamento entrar. Se nenhum desses PRs aparecer, isto aqui vira
       * divida silenciosa - e o aviso no terminal e o que lembra disso.
       */

      // 12 ocorrencias, todas em `dashboard/waitlist.ts`: linhas de resultado
      // do `pg`, que chegam como `any` porque o driver nao sabe o schema.
      // Corrigir de verdade e tipar o retorno das queries, nao silenciar -
      // trabalho util e independente deste PR.
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",

      // 14 ocorrencias: `as X` que o compilador ja inferia. Limpeza mecanica
      // e segura, espalhada por 8 arquivos - PR proprio.
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",

      // 1 ocorrencia (server.ts, o `reject(err)` do parse de corpo JSON).
      // `JSON.parse` sempre lanca `SyntaxError`, que E um Error - entao na
      // pratica o contrato esta cumprido; o que falta e o tipo provar isso.
      "@typescript-eslint/prefer-promise-reject-errors": "warn",

      /*
       * 10 ocorrencias, todas em `dashboard/views.ts`: constantes de icone e
       * um data URI de logo declarados e nunca usados. Confirmei que JA
       * EXISTEM na master, ou seja, e codigo morto preexistente e nao sobra
       * de trabalho em andamento. Mesmo assim nao sao removidas aqui, porque
       * aquele arquivo esta sendo editado agora em outra branch e deletar
       * declaracao no meio disso cria conflito por nada.
       *
       * Argumento com prefixo `_` segue permitido - e convencao do
       * repositorio (ex: `_fromBlock` em `EvmAdapter.getFeeAdjustment`, que
       * existe pra cumprir a assinatura do contrato sem usar o parametro).
       */
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  {
    /*
     * Em teste, asserção de tipo e acesso a membro de `any` são ferramenta de
     * trabalho: montar um log falso do viem, ou um payload malformado de RPC,
     * exige construir valores que o tipo real não permite — é exatamente o
     * que o teste precisa exercitar. A restrição continua valendo em `src/`
     * fora de teste, que é onde ela protege algo.
     *
     * `adapter-conformance.ts` entra aqui por ser suíte de teste em forma de
     * módulo (é importada por arquivos `.test.ts`), e precisa inspecionar a
     * cadeia de protótipos de um adaptador arbitrário pra verificar que ele
     * não carrega material de assinatura.
     */
    files: ["**/*.test.ts", "src/engine/chains/adapter-conformance.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-explicit-any": "off",
      /*
       * 5 ocorrências, todas em asserção de teste do tipo
       * `expect(obj.metodo).toHaveBeenCalled()`. Passar o método como valor é
       * precisamente o que o teste quer fazer ali; o risco de `this`
       * desamarrado que a regra protege não existe quando ninguém chama o
       * método.
       */
      "@typescript-eslint/unbound-method": "off",
    },
  },

  {
    /*
     * Fora de `src/` - os `scripts/`, a config do vitest, este arquivo - roda
     * so a parte sintatica.
     *
     * Motivo: `tsconfig.json` inclui apenas `src/**`, porque e o que vai pro
     * build. As regras com tipo exigem que o arquivo pertenca a um projeto
     * TypeScript, e sem isso falhavam com 10 erros de parsing que nao diziam
     * nada sobre o codigo, so sobre a configuracao. As duas alternativas eram
     * piores: incluir `scripts/` no tsconfig muda o que o build compila, e um
     * `tsconfig.lint.json` paralelo e mais uma configuracao pra divergir da
     * real sem ninguem notar.
     *
     * O que se perde: `scripts/verify-contributor-signature.ts` chama `main()`
     * sem `await` no fim - mesma familia do bug que o
     * `no-misused-promises` achou, mas severidade baixa (CLI de
     * desenvolvimento, rodado a mao; o sintoma e stack trace confuso, nao
     * monitor parado). Fica anotado pra um PR proprio em vez de esquecido.
     */
    files: ["scripts/**", "*.config.ts", "*.config.js", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
