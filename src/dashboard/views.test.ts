import { describe, expect, it } from "vitest";
import { dashboardPage, loginPage } from "./views.js";

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

describe("aviso de instalação do PWA no login", () => {
  it("a tela de login ensina a instalar nos dois sistemas", () => {
    // Quem chega direto no /login (link salvo, alerta antigo) nunca passa pela
    // landing - e no iOS a instalação é obrigatória pro push funcionar.
    const html = loginPage({});

    expect(html).toContain("Instale no celular");
    expect(html).toContain("Android");
    expect(html).toContain("iPhone");
  });

  it("o aviso em si é estático - nenhum texto dele depende de script", () => {
    /**
     * Corrige uma afirmação errada minha: a versão anterior deste teste dizia
     * que a tela de login não tem script nenhum, "porque usa CSP com nonce".
     * Conferindo a resposta real do servidor, NÃO existe cabeçalho CSP - e a
     * página passou a ter um script, o registro do service worker, sem o qual
     * o Chrome no Android não oferece instalar o app.
     *
     * O que importa de verdade é o que este teste afirma agora: as instruções
     * de instalação chegam como HTML, então aparecem mesmo com script
     * bloqueado ou falhando.
     */
    const semScripts = loginPage({}).replace(/<script[\s\S]*?<\/script>/g, "");

    expect(semScripts).toContain("Instale no celular");
    expect(semScripts).toContain("Adicionar à Tela de Início");
  });

  it("registra o service worker - sem isso o Chrome no Android não oferece instalação", () => {
    // Era a causa raiz: manifest e ícones corretos, mas o SW só era
    // registrado no fluxo de ativar push, depois do login.
    expect(loginPage({})).toContain('navigator.serviceWorker.register("/sw.js"');
  });

  it("o aviso não aparece no lugar da mensagem de erro", () => {
    // Guarda contra o aviso empurrar o erro de credencial pra fora da vista:
    // numa tela de login, o erro é a informação mais urgente.
    const html = loginPage({ error: "Credenciais inválidas." });

    expect(html).toContain("Credenciais inválidas.");
    expect(html.indexOf("Credenciais inválidas.")).toBeLessThan(html.indexOf("Instale no celular"));
  });
});
