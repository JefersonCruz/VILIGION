import { defineConfig } from "vitest/config";

/**
 * Existe por um motivo só, mas importante: sem este arquivo, o vitest coletava
 * TAMBÉM as cópias compiladas dos testes em `dist/` (achado em 2026-10-08).
 * Cada teste rodava duas vezes - uma do fonte em `src/`, outra de um .js
 * compilado que só muda quando alguém roda `npm run build`.
 *
 * Dois problemas reais que isso causava:
 * 1. Toda contagem de teste citada no projeto (pitch, BUSINESS-PLAN, auditoria)
 *    estava dobrada - "178 testes" eram ~89 distintos naquele momento.
 * 2. A cópia em `dist/` testa o código de quando foi compilada, não o atual:
 *    podia passar com o fonte quebrado, ou falhar depois de uma correção
 *    legítima, gerando ruído que faz o time desconfiar da própria suíte.
 *
 * O CI (.github/workflows/ci.yml) roda `npm run build` antes do vitest, então
 * ele sempre caía nesse caso.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "dist/**"],
  },
});
