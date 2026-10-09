import { describe, expect, it } from "vitest";
import { dashboardPage } from "./views.js";

/**
 * `dashboardPage` é função pura (ver cabeçalho de views.ts), então dá pra
 * travar o que a tela mostra sem subir servidor nem fazer login.
 *
 * O caso que motivou este arquivo: o painel renderizava `balanceRaw` cru
 * dentro de `<code>` — o usuário via "42180320000" no lugar do saldo
 * (ver docs/UI-DESIGN-STUDY.md §0). É regressão silenciosa: nada quebra,
 * a tela só fica parecendo inacabada.
 */
const baseParams = {
  address: "0x4f3a000000000000000000000000000000000c921",
  balanceRaw: "42180320000",
  accountsCount: 2,
  recentAlerts: [],
};

describe("dashboardPage", () => {
  it("mostra o saldo formatado como moeda, não a unidade bruta do token", () => {
    const html = dashboardPage(baseParams);

    expect(html).toContain("US$ 42.180,32");
    // o valor bruto só pode aparecer no title (pra quem precisar conferir), nunca como o número em destaque
    expect(html).not.toContain("<code>42180320000</code>");
    expect(html).toContain('title="42180320000');
  });

  it("encurta o endereço na tela e mantém o completo no title", () => {
    const html = dashboardPage(baseParams);

    expect(html).toContain("0x4f3a…c921");
    expect(html).toContain(`title="${baseParams.address}"`);
  });

  it("não quebra se o saldo vier inválido do RPC — mostra travessão", () => {
    const html = dashboardPage({ ...baseParams, balanceRaw: "indisponível" });

    expect(html).toContain("—");
    expect(html).not.toContain("US$ NaN");
  });

  it("lista os alertas recentes quando existem", () => {
    const html = dashboardPage({
      ...baseParams,
      recentAlerts: [{ kind: "balance-drop", createdAt: "2026-10-09T12:00:00Z" }],
    });

    expect(html).toContain("balance-drop");
    expect(html).not.toContain("Nenhum alerta ainda");
  });
});
