# Limiares de alerta — plano, estrutura e componentes

Documento de referência da funcionalidade "o usuário define quando quer ser avisado". Cobre objetivos, estado atual, arquitetura, componentes, plano de desenvolvimento e testes. Protótipo visual: [mockups/thresholds.html](mockups/thresholds.html) (capturas em `mockups/thresholds.png` e `mockups/thresholds-erro.png`).

---

## 1. Objetivos

| # | Objetivo | Como medimos |
|---|----------|--------------|
| O1 | O usuário entende o que está configurando sem conhecer "janela", "bigint" ou "unidade do token". | Escolhe um perfil pronto em 1 clique; vê quanto isso significa em dólares no saldo dele. |
| O2 | Uma edição vale **imediatamente**, sem reiniciar o processo. | Teste: alterar o limiar e o próximo ciclo do monitor já usa o novo valor. |
| O3 | Valores incoerentes são impossíveis de salvar. | Validação no servidor (a tela só ajuda; o servidor decide). |
| O4 | Queda **gradual** (esvaziar a conta em partes) também é detectada. | Teste de dreno gradual dentro da janela. |
| O5 | Preservar o diferencial do produto: o limiar continua privado por usuário e nada novo vaza em alerta. | Alertas continuam sem saldo/endereço (ver SECURITY.md). |

**Fora de escopo (decidido):** z-score / baseline estatístico. Com dados de poucos dias ele geraria falso positivo e um alerta crítico (ligação) falso destrói a confiança. Fica no roadmap como "baseline adaptativo" apenas para alertas **normais** (e-mail).

---

## 2. Estado atual e defeitos

Arquivos relevantes: [src/engine/rules/detection-rules.ts](../src/engine/rules/detection-rules.ts), [src/monitor.ts](../src/monitor.ts), [src/index.ts](../src/index.ts) (`startMonitorForAccount`), [src/dashboard/server.ts](../src/dashboard/server.ts) (`parseThresholdsForm`), [src/dashboard/views.ts](../src/dashboard/views.ts) (`thresholdsPage`).

| ID | Defeito | Causa | Impacto |
|----|---------|-------|---------|
| D1 | Editar limiares não muda o monitor em execução. | `Monitor` recebe `thresholds` no construtor; `startMonitorForAccount` lê do banco uma única vez. | O usuário acha que protegeu e não protegeu até o próximo deploy. **Pior defeito: falsa sensação de segurança.** |
| D2 | "Janela" não é janela deslizante. | `checkBalanceDrop` compara só dois snapshots consecutivos (15 s) e descarta se passou de `windowMinutes`. | Esvaziar a conta em parcelas pequenas nunca atinge o percentual. |
| D3 | Sem validação. | `parseThresholdsForm` só faz `Number`/`BigInt`. | Dá para salvar crítico < normal, 0 %, 500 %, janela negativa. |
| D4 | Valor de transferência bloqueada em unidade crua do token. | Campo texto com `bigint`. | Usuário não sabe se `1000000` é US$ 1 ou US$ 1 milhão (token tem 6 casas). |
| D5 | Sem feedback do que o número significa. | Só quatro caixas numéricas. | Usuário chuta valores. |

---

## 3. Arquitetura alvo

```
 Navegador (/thresholds)                         Servidor
 ┌──────────────────────────┐   POST form   ┌──────────────────────────────┐
 │ presets + sliders + prévia│ ───────────▶ │ parseThresholdsForm()        │
 │ (JS só de conveniência)   │              │   └ validateThresholds()  ◀── fonte da verdade
 └──────────────────────────┘              │ thresholdsRepo.upsert()      │
            ▲  GET (valores + saldo)        └──────────────┬───────────────┘
            │                                              │ (Postgres: user_thresholds)
            │                               ┌──────────────▼───────────────┐
            └───────────────────────────────│ ThresholdsProvider.get(user) │ ◀── lido a CADA tick
                                            └──────────────┬───────────────┘
                                            ┌──────────────▼───────────────┐
                                            │ Monitor.tick()               │
                                            │  BalanceHistory (janela)     │
                                            │  checkBalanceDrop(history)   │
                                            └──────────────────────────────┘
```

Princípios:
1. **Servidor é a fonte da verdade.** O JavaScript da tela é só conveniência; toda regra é revalidada no `POST`.
2. **Sem cache de longa duração.** O monitor consulta o provedor a cada ciclo (15 s). Custo: 1 `SELECT` por conta por ciclo — aceitável; se virar problema, cache de 5 s.
3. **Núcleo continua agnóstico de chain.** Conversão USD↔unidade usa os `decimals` do token da conta, nunca um valor fixo no engine.

---

## 4. Componentes

### C1. `validateThresholds` — `src/engine/rules/threshold-validation.ts` (novo)
Função pura `validateThresholds(t: UserThresholds): string | null` (mensagem em português ou `null`).
Regras:
- `0.1 ≤ maxBalanceDropPct < criticalBalanceDropPct ≤ 100`
- `windowMinutes` inteiro em `[1, 1440]`
- `blockedTransferAlertThreshold ≥ 0` e `< criticalBlockedTransferThreshold`
- números finitos (rejeita `NaN`/`Infinity`)

### C2. `THRESHOLD_PRESETS` — `src/engine/rules/threshold-presets.ts` (novo)
| Perfil | Aviso (e-mail) | Crítico (ligação) | Janela | Bloqueada aviso / crítico (US$) |
|---|---|---|---|---|
| Conservador | 5 % | 20 % | 60 min | 500 / 5.000 |
| Equilibrado (padrão sugerido) | 10 % | 30 % | 60 min | 2.000 / 20.000 |
| Tolerante | 20 % | 50 % | 120 min | 10.000 / 50.000 |
| Personalizado | livre | livre | livre | livre |

Valores em USD; a conversão para unidade do token é feita por C3.

### C3. `usdToTokenUnits` / `tokenUnitsToUsd` — `src/engine/rules/token-units.ts` (novo)
Conversão com `bigint` (sem `Number` para não perder precisão): `usd * 10^decimals`. Decimais vêm do adaptador/conta (TIP-20 em Tempo = 6). Entrada com no máximo `decimals` casas.

### C4. `ThresholdsProvider` — em `src/monitor.ts`
`MonitorConfig.thresholds` passa de `UserThresholds` para `UserThresholds | (() => Promise<UserThresholds>)`. Dentro do `tick`, resolve-se uma vez por ciclo e o mesmo objeto é usado para saldo **e** extensão (consistência dentro do ciclo). Em `index.ts`, o provedor é `() => thresholdsRepo.get(userId) ?? defaults`. Se a leitura falhar, usa o último valor válido (nunca "sem proteção").

### C5. `BalanceHistory` + `checkBalanceDrop` em janela — `detection-rules.ts`
- O monitor guarda os snapshots dos últimos `windowMinutes` (descarta os mais velhos; limite rígido de memória, ex.: 1440 min / 15 s ≈ 5.760 pontos máx.).
- Regra: `pico = maior saldo na janela`; `queda = (pico − atual) / pico`; compara com os limiares. A queda é **cumulativa** na janela.
- A taxa legítima (`getFeeAdjustment`) continua sendo somada ao saldo atual antes de comparar.
- Anti-repetição: após disparar, o pico de referência passa a ser o saldo atual (evita alertar a cada 15 s pelo mesmo evento).
- Mudança de janela em runtime apenas redefine o corte; não exige reinício.

### C6. `thresholdsPage` (redesenhada) — `src/dashboard/views.ts`
Seguindo o protótipo:
- Cabeçalho + selo "Alterações valem imediatamente, sem reiniciar".
- 4 cartões de perfil; selecionar preenche os campos; editar um campo muda para "Personalizado".
- Cartão **Queda de saldo**: dois controles (aviso %, crítico %) com slider + número; janela em botões 15 min / 1 h / 6 h / 24 h.
- Cartão **Transferência bloqueada**: campos em **US$**.
- **Prévia** lateral: medidor com zonas verde/amarela/vermelha, cartões "e-mail a partir de US$ X" e "ligação a partir de US$ Y" calculados com o **saldo real monitorado**, e simulador ("e se o saldo cair para…") mostrando qual canal dispararia.
- Barra de salvar fixa: estados *alterações não salvas* / *corrija os campos* / *tudo salvo*.
- Erros do servidor reaparecem na tela mantendo o que o usuário digitou.

### C7. `parseThresholdsForm` / `handleUpdateThresholds` — `server.ts`
Converte campos (USD→unidades via C3), chama C1, em erro re-renderiza a página com a mensagem e os valores digitados (status 400); em sucesso grava e redireciona para `/thresholds?salvo=1`.

### C8. Saldo para a prévia
`GET /thresholds` precisa do saldo atual. Fonte: último snapshot do monitor da conta (guardado em memória pelo `Monitor`, exposto por um `BalanceReader` simples). Sem snapshot ainda → prévia usa estado vazio ("aguardando primeira leitura") em vez de inventar número.

---

## 5. Contrato do formulário (`POST /thresholds`)

| Campo | Tipo | Regra |
|---|---|---|
| `maxBalanceDropPct` | decimal | 0,1–100, < crítico |
| `criticalBalanceDropPct` | decimal | ≤ 100, > aviso |
| `windowMinutes` | inteiro | 1–1440 |
| `blockedWarnUsd` | decimal (≤ 6 casas) | ≥ 0, < crítico |
| `blockedCritUsd` | decimal (≤ 6 casas) | > aviso |

Resposta: `302 /thresholds?salvo=1` ou `400` com a página e a mensagem. Requer sessão (já existente). Sem mudança de esquema no banco: continuam as colunas de `user_thresholds`; a conversão USD↔unidade ocorre só na borda.

---

## 6. Plano de desenvolvimento

Estimativas em horas de uma pessoa. Ordem pensada para entregar valor de segurança primeiro e deixar a tela para depois.

| Etapa | Entrega | Componentes | Est. | Depende de |
|---|---|---|---|---|
| E1 | Edição vale ao vivo | C4 | 1,5 h | — |
| E2 | Validação no servidor | C1, C7 (parcial) | 1,5 h | — |
| E3 | Janela deslizante real | C5 | 3 h | E1 |
| E4 | USD em vez de unidade crua | C3, C7 | 1,5 h | E2 |
| E5 | Perfis prontos | C2 | 1 h | E4 |
| E6 | Tela nova + prévia com saldo real | C6, C8 | 5 h | E2–E5 |
| E7 | Testes finais, deploy, verificação em produção | — | 1,5 h | todas |

Total ≈ 15 h. Caminho mínimo de segurança (E1+E2+E3) ≈ 6 h.

### Cronograma (hoje 06/10; prazo 12/10 23:59 PT)
- **Qua 07/10:** E1, E2, E3 + testes (corrige D1–D3, o que realmente protege o usuário).
- **Qui 08/10:** E4, E5, E6.
- **Sex 09/10:** E7, deploy, gravação do demo usando a tela nova.
- **Sáb 10/10:** **congelar deploys** (deploy reinicia o processo e perde sessões, PIN e TwiML em memória). Só correção crítica.
- Se atrasar: cortar E6 para a tela atual + validação; E1–E3 não são negociáveis.

### Riscos
| Risco | Mitigação |
|---|---|
| Janela deslizante muda o comportamento e gera alerta inesperado. | Testes de regressão para o caso antigo (queda súbita entre 2 snapshots continua alertando); anti-repetição. |
| Leitura do banco a cada ciclo derruba o monitor se o banco cair. | Usar o último limiar válido em memória; logar a falha. |
| Perda de precisão em conversão de moeda. | Tudo em `bigint`; testes com 6 casas. |
| Alerta falso crítico por oscilação normal. | Perfil padrão Equilibrado (30 % crítico) e anti-repetição; z-score fora do escopo. |
| Usuário já tem valores salvos que violam as novas regras. | Leitura tolerante (não valida ao ler); só valida ao salvar; tela mostra aviso se valores atuais forem inválidos. |

---

## 7. Plano de testes

Unitários (vitest, junto dos arquivos):
- **C1:** crítico ≤ aviso; pct 0, 101, `NaN`; janela 0, 1441, 1,5; aviso bloqueada ≥ crítico; caso válido de cada perfil.
- **C3:** `1 → 1_000_000n`, `0,5 → 500_000n`, `1234,567891`, mais de 6 casas rejeita, ida e volta sem perda.
- **C5:** queda súbita (compatibilidade); dreno gradual 4 × 3 % em 40 min com limiar de 10 % dispara; mesma queda fora da janela não dispara; saldo sobe e cai; histórico vazio/1 ponto; saldo zero; taxa legítima não dispara; anti-repetição.
- **C4:** monitor com provedor que muda o valor entre ciclos passa a usar o novo valor no ciclo seguinte; provedor que lança erro mantém o último valor.

Integração (`server`):
- `POST /thresholds` válido grava em unidades do token e redireciona; inválido devolve 400 com mensagem e não grava; sem sessão → login.
- `GET /thresholds` renderiza valores atuais em US$ e o perfil correspondente marcado.

Manual (antes do deploy): abrir a tela, trocar de perfil, editar campo → "Personalizado", salvar com erro, salvar com sucesso, simular queda; conferir no log do Railway que o monitor usou o novo valor no ciclo seguinte.

---

## 8. Critérios de pronto

- [x] Editar o limiar muda o comportamento do monitor no ciclo seguinte (teste automatizado).
- [x] Nenhum conjunto incoerente é gravado (teste automatizado).
- [x] Dreno gradual é detectado (teste automatizado).
- [x] Campos de transferência bloqueada em US$, sem unidade crua na tela.
- [x] Suíte completa passa (176 testes) e `tsc` sem erro.
- [ ] Deploy feito com `railway up -s viligion-app --detach` e `/thresholds` verificado em produção.
- [ ] `BUSINESS-PLAN.md` e `ARCHITECTURE.md` refletem a nova contagem de testes e a janela deslizante.

## 9. Roadmap (depois do hackathon)
- Baseline adaptativo (z-score/EWMA) só para alertas normais, com aprendizado mínimo de 14 dias e opt-in.
- Limiares por conta/token (hoje é por usuário).
- Horário de silêncio e limite diário de ligações críticas.
- Histórico de alterações de limiar (quem mudou, quando) — útil contra coação: mudança de limiar exige confirmação por canal secundário.
