# Estudo de UI — cor, tipografia e telas

> Escrito em 2026-10-09. Complementa `docs/UI-SPEC.md` (que cobre **quais** telas existem e como funcionam) — este cobre **como elas deveriam parecer**. Foco: tirar a aparência de "gerado por IA / feito por engenheiro às pressas" sem redesenhar o produto do zero.

## 0. O diagnóstico honesto, antes da paleta

Três coisas afundam a percepção de qualidade hoje, e só uma é sobre cor:

1. **O número principal do produto está cru.** `/dashboard` renderiza `balanceRaw` dentro de `<code>` — o usuário vê `42180320000`, não `$42.180,32`. `unitsToUsdString()` (`engine/rules/token-units.ts`) já existe e não é usada ali. Nenhuma paleta conserta uma tela cujo dado central é saída de máquina.
2. **São dois produtos visualmente.** A landing virou dark/cyan (2026-10-07); o painel inteiro (`BASE_STYLE`) continua lilás-claro com botão roxo em gradiente. Quem se cadastra atravessa uma troca de identidade no meio do fluxo.
3. **"Cara de IA" não vem de falta de sombra — vem do excesso dela.** O pedido natural é "arredondar mais e sombrear mais". Isso é exatamente o que produz o visual genérico. Ver §5.

## 1. O que especificamente grita "feito por IA" hoje

Cada item abaixo aponta o valor real no código, não uma impressão vaga:

| Sintoma | Onde | Por que denuncia |
|---|---|---|
| Botão com gradiente roxo (`linear-gradient(180deg,#8b5cf6,#6d28d9)`) | `BASE_STYLE` | Violeta em gradiente é o sotaque nº 1 de template gerado. Produto de segurança não fala violeta. |
| Fundo lavanda com `radial-gradient` | `BASE_STYLE` body | Fundo colorido "decorativo" sem função. Ferramenta de monitoramento quer fundo neutro: a cor deve vir do **dado** (crítico/normal), não do papel de parede. |
| Um raio só (12px) e uma sombra só (`0 4px 24px`) em tudo | `.card` | Quando toda superfície tem a mesma elevação, nada tem hierarquia — a tela vira um tabuleiro de retângulos iguais. |
| Tipografia quase plana (0.78–1.05rem) | todo o painel | Sem escala, o olho não sabe onde pousar. `h1` tem 1.5rem; o saldo, que é a informação mais importante do produto, tem o mesmo tamanho de um parágrafo. |
| `max-width: 760px` + `padding: 24px` em tudo | `main` | Largura de blog. Painel de monitoramento pede densidade e tabelas largas, não coluna de leitura. |
| Endereços como `<code>0x4f3a…</code>` sem truncar nem copiar | `/dashboard`, `/accounts` | Mostra que ninguém pensou no gesto real do usuário (conferir e copiar endereço). |
| Estados vazios como "Nenhum alerta ainda." | `/dashboard`, `/alerts` | Momento perdido: é a hora de explicar o que vai acontecer e dar a próxima ação. |

## 2. Estudo de cor

**Princípio**: uma identidade só, dois modos. A landing já fixou a marca (fundo quase-preto azulado, acento ciano, alerta âmbar). O painel vira o irmão diurno dela — mesmos acentos, neutros frios, **sem lilás**.

### Neutros (a base — 90% da tela)
Escala fria (azulada) para casar com o ciano, em vez do cinza-arroxeado atual:

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#F7F8FA` | `#0A0E17` | fundo da página |
| `--surface` | `#FFFFFF` | `#0E1521` | cartão, tabela |
| `--surface-2` | `#F1F3F7` | `#141C2B` | cabeçalho de tabela, campo |
| `--border` | `#E2E6ED` | `#1B2433` | divisória, contorno |
| `--border-strong` | `#CBD2DD` | `#2A3449` | contorno de campo em foco/hover |
| `--text` | `#0F172A` | `#F1F5F9` | texto principal |
| `--text-muted` | `#5A6472` | `#8B95A7` | rótulo, apoio |

`--text-muted` claro foi escolhido em `#5A6472` (não `#6b6475` do tema atual) para passar 4.5:1 sobre `#FFFFFF` **e** sobre `#F1F3F7` — o cinza atual falha sobre superfície secundária.

### Acentos (usar pouco — é o que dá ar profissional)
| Token | Valor | Uso | Regra |
|---|---|---|---|
| `--accent` | `#0E7490` (claro) / `#22D3EE` (escuro) | ação primária, link, foco | O ciano claro da landing (`#22d3ee`) **não** tem contraste sobre branco (≈1.9:1). No tema claro use o ciano escurecido `#0E7490` para texto/botão; reserve `#22D3EE` para o modo escuro. |
| `--critical` | `#B42318` / `#FCA5A5` | severidade crítica | Nunca como decoração. |
| `--warning` | `#B54708` / `#FBBF24` | atenção, pendência | — |
| `--ok` | `#027A48` / `#34D399` | saudável, confirmado | — |

**Proibições deliberadas**: nada de violeta; nada de gradiente em botão (fundo chapado + 1px de borda interna sutil); no máximo um acento por tela em destaque.

## 3. Tipografia

Hoje é um stack de sistema só, com tamanhos quase iguais. Proposta — **duas famílias, três trabalhos**:

- **Display** (`Space Grotesk`, já carregada na landing): só `h1`/`h2` e o número-herói do painel.
- **Texto** (stack de sistema): corpo, rótulo, tabela. Não trocar por Inter — Inter em tudo é outro sotaque de template.
- **Números** (`ui-monospace` tabular, ou o stack de texto com `font-variant-numeric: tabular-nums`): **obrigatório** em saldo, limiar, data e qualquer coluna numérica. Sem tabular-nums, os dígitos "dançam" entre linhas da tabela — é o detalhe que separa produto financeiro de protótipo.

### Escala (1.25, truncada — não inventar tamanhos fora dela)
| Papel | Tamanho / peso / tracking |
|---|---|
| Número-herói (saldo) | 40px / 700 / `-0.02em` / tabular |
| Título de tela (`h1`) | 24px / 700 / `-0.015em` |
| Seção (`h2`) | 18px / 600 |
| Corpo | 15px / 400 / `line-height: 1.55` |
| Rótulo de campo | 13px / 500 |
| Cabeçalho de tabela / meta | 12px / 600 / `0.04em` / maiúscula |

Regra prática: **não usar mais de 4 tamanhos na mesma tela.**

## 4. Densidade e layout

- Painel sai de `max-width: 760px` para **1120px** (igual à landing) — tabela de contas e de alertas precisam de largura.
- Altura de linha de tabela: 44px (confortável pra clicar, denso o bastante pra ver 10 linhas sem rolar).
- Espaçamento em escala de 4: `4, 8, 12, 16, 24, 32, 48`. Nada de `18px`/`22px` soltos como hoje.
- Cabeçalho de tabela fixo (`position: sticky`) quando a lista passa de 10 linhas.

## 5. Raio e sombra — por que "mais sombra" é a resposta errada

Sombra deve significar **elevação real** (algo flutua acima do resto). Quando todo cartão tem sombra, ela deixa de significar e vira textura — o visual "bootstrap com esteroides" que o pedido quer evitar.

**Sistema de elevação (só três níveis):**
| Nível | Uso | Valor |
|---|---|---|
| 0 | cartão, tabela, campo — **o padrão** | sem sombra; separação por `1px solid var(--border)` |
| 1 | item em hover, linha ativa | `0 1px 2px rgba(15,23,42,.06)` + borda mais forte |
| 2 | o que de fato flutua: dropdown, modal, toast | `0 12px 32px -8px rgba(15,23,42,.18)` |

**Raio (três valores, com significado):**
- `6px` — controles (botão, campo, pill)
- `10px` — contêineres (cartão, tabela)
- `999px` — só badge/avatar

Hoje tudo é 8px ou 12px sem critério. O ganho de "profissional" vem da **consistência** e do contraste entre níveis, não da quantidade de blur.

## 6. Tela por tela

**`/login` e `/signup`** — já são as mais cuidadas (cartão centralizado). Ajustes: tirar o gradiente roxo do botão; o logo acima do cartão pode ir pra 32px; mensagem de erro com ícone + borda esquerda `--critical`, não só fundo rosa.

**`/dashboard`** — a tela que mais precisa:
1. Saldo formatado como moeda, 40px, tabular, com o token ao lado em `--text-muted` ("PathUSD · Tempo"). Hoje é unidade bruta em `<code>`.
2. **Faixa de estado de monitoramento no topo** — "Monitorando · último ciclo há 12s" com ponto pulsante verde. O produto é vigilância; a prova de que está vigiando tem que ser a primeira coisa na tela. (O dado existe: o health check do monitor foi construído em 2026-10-08.)
3. Endereço truncado no meio (`0x4f3a…c921`) em mono, com botão copiar.
4. Últimos alertas viram linhas com severidade à esquerda (barra de 3px colorida + ícone), hora relativa à direita.
5. Estado vazio: "Nenhum alerta desde que o monitoramento começou" + link pra `/thresholds`.

**`/accounts`** — tabela com cabeçalho em `--surface-2`, chain como badge discreto, endereço mono truncado, ação "Remover" só como ícone em hover (hoje é um botão vermelho competindo com o conteúdo). Formulário de adicionar vai pra um cartão separado abaixo, com os dois campos de endereço bem diferenciados (o aviso de "não confunda" já existe — vira texto de apoio sob cada campo, não um bloco de 2 parágrafos acima).

**`/recipients`** — telefone e e-mail como duas listas separadas com ícone próprio, não uma lista misturada. O botão "Enviar alerta de teste" merece destaque de ação secundária, com um estado de confirmação visível depois do clique.

**`/alerts`** — é um log: densidade alta, fonte tabular na data, severidade como coluna fixa à esquerda, filtro por severidade no topo. Hoje é uma tabela genérica.

**`/thresholds`** — a mais recente e a melhor do painel; só precisa herdar os tokens novos (hoje tem CSS próprio em `thresholds-ui.ts`, risco de divergir).

## 7. Checklist anti-"cara de IA"

- [ ] Nenhum gradiente em botão ou fundo (exceto o halo já existente da landing)
- [ ] Nenhum violeta
- [ ] Sombra só em coisa que flutua de verdade (§5)
- [ ] Nenhum emoji como ícone — SVG de traço, 1.5–1.8px, tamanho consistente
- [ ] Números financeiros sempre tabulares e formatados como moeda
- [ ] Toda cor de status acompanhada de forma/ícone (daltonismo, e evita "arco-íris de pills")
- [ ] Máximo 4 tamanhos de fonte por tela
- [ ] Todo estado vazio diz o que vai acontecer e oferece a próxima ação
- [ ] Foco visível em todo elemento interativo (`:focus-visible`, 2px, `--accent`)
- [ ] Nada centralizado "por padrão" — texto corrido alinhado à esquerda

## 8. Ordem sugerida de implementação

Do maior ganho por esforço pro menor:

1. **Formatar o saldo** no `/dashboard` (usa função que já existe) — menor esforço, maior impacto isolado.
2. **Tokens de cor + tipografia** em `BASE_STYLE` (variáveis CSS em `:root`), matando o lilás/roxo — uma edição, muda todas as telas de uma vez.
3. **Sistema de elevação e raio** (§5) aplicado em `.card`, `input`, `button`, `table`.
4. **Faixa de estado de monitoramento** no `/dashboard`.
5. Refino tela a tela (§6), na ordem `/dashboard` → `/alerts` → `/accounts` → `/recipients`.

Passos 1–3 são de baixo risco e não mexem em lógica; 4 precisa expor o estado do monitor pro painel (hoje o health check só notifica, não é consultável pela UI).
