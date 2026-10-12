<!--
Obrigado por contribuir. Apague as seções que não se aplicam ao seu PR —
este template cobre vários tipos de mudança e ninguém precisa preencher tudo.
-->

## O que muda, e por quê

<!-- O problema que isso resolve. Se há uma issue, referencie com "Closes #N". -->

## Zona afetada

<!-- Ver CONTRIBUTING.md pra divisão entre as zonas. -->

- [ ] Zona 1 — `engine/` (chains, rules) — camada aberta
- [ ] Zona 2 — `privacy/`, `alerts/`, `dashboard/` — **camada sensível, exige justificativa de segurança abaixo**
- [ ] Documentação
- [ ] Infraestrutura / CI / build

## Verificação

```
npm test
npx tsc -p tsconfig.json --noEmit
```

- [ ] Os dois comandos passam localmente
- [ ] Testes novos cobrem o comportamento que mudou (e falhariam sem a mudança)
- [ ] Nenhum segredo, credencial, endpoint privado ou dado real de usuário em código, teste, fixture ou documentação

**O que eu verifiquei de fato:**

<!-- Seja concreto. "Rodei contra a Sepolia em 02/11, conferi leitura de saldo
     de um endereço conhecido" é útil. "Testado e funcionando" não é. -->

**O que eu NÃO verifiquei:**

<!-- Lacuna declarada é revisada rápido. Lacuna escondida é o que torna a
     revisão lenta e desconfortável pra todo mundo. Se não há nenhuma, diga
     isso explicitamente. -->

---

## Se este PR adiciona ou altera um adaptador de rede

<!-- Apague esta seção inteira se não for o caso. Guia completo:
     docs/DEVELOPING_ADAPTERS.md · Contrato: docs/ADAPTER_SPEC.md -->

- [ ] Passa `describeAdapterConformance` (inclusive o `createFailing()` obrigatório)
- [ ] Tem testes próprios de decodificação, com fixtures determinísticas e offline
- [ ] `capabilities` reflete o que a rede de fato observa — nenhuma capacidade ausente devolve valor plausível
- [ ] Falha de rede **propaga**; nenhum `catch` devolve `0n`, valor em cache ou chute
- [ ] `getFeeAdjustment` nunca devolve negativo
- [ ] Somente leitura: nenhuma chave privada, mnemônico, signer ou caminho de escrita na cadeia
- [ ] Não importa nada de `privacy/`, `alerts/` ou `dashboard/`
- [ ] Linha adicionada em `docs/CHAIN-SUPPORT-MATRIX.md`, com limitações preenchidas honestamente
- [ ] `supportStatus` corresponde à evidência que existe (comece em `experimental`)
- [ ] Núcleo intocado — `monitor.ts`, `detection-rules.ts` e `/alerts` não foram alterados

Se você **precisou** mexer no núcleo, descreva aqui o que o contrato não cobria. Isso é um achado sobre a arquitetura, não um problema do seu PR — e é mais útil pro projeto que a gambiarra.

**Mantenedor da integração:** <!-- seu @handle, ou "nenhum" se é uma contribuição pontual. "Nenhum" é resposta honesta e aceita; afeta só o status que a integração pode alcançar. -->

---

## Se este PR toca a zona sensível (`privacy/`, `alerts/`, `dashboard/`)

<!-- Apague se não for o caso. -->

- [ ] Li o modelo de ameaça em `SECURITY.md`
- [ ] Nenhum alerta passou a conter saldo, endereço ou valor monetário (`alert-content-policy.ts`)
- [ ] Nenhum caminho novo executa transação on-chain a partir de resposta de voz/SMS/WhatsApp
- [ ] Nenhum limiar numérico de usuário foi hardcoded em código público
- [ ] `npx vitest run src/alerts/alert-content-policy.test.ts src/privacy` passa

**Como esta mudança preserva (ou melhora) cada item da tabela de mitigação do `SECURITY.md`:**

<!-- Obrigatório pra esta zona. -->

---

## Dependências novas

<!-- Apague se não há nenhuma. -->

| Pacote | Pra quê | Por que não dá sem ela |
|---|---|---|

Dependência nova no caminho do alerta é superfície de ataque nova no caminho do alerta.

---

> **Vulnerabilidade de segurança nunca vai em PR ou issue pública.** Use o processo de divulgação responsável do [`SECURITY.md`](../SECURITY.md).
