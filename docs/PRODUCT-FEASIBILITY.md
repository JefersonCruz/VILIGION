# Estudo de Viabilidade — Melhorias de Produto

> Documento de planejamento interno, complementar ao [`BUSINESS-PLAN.md`](./BUSINESS-PLAN.md) — aquele cobre mercado, monetização, fases e a empresa; este cobre **o que especificamente construir a seguir no produto**, com esforço/risco/impacto por item, pra decidir ordem de execução. Escrito em 2026-10-08, ~4-5 dias antes do prazo de submissão (12-13/10 — ver nota de data em `BUSINESS-PLAN.md` §2).

## 0. Regra que domina todas as outras

**Nada neste documento entra antes do Bloco 1-4 já definido em `BUSINESS-PLAN.md` §6** (redeploy real, teste de ponta a ponta do canal crítico com Twilio de verdade, gravação dos vídeos, submissão) — **com uma exceção**: o item 1 abaixo (bug do monitor) é pré-requisito pro próprio Bloco 1 funcionar, não uma melhoria opcional. Todo o resto aqui é material pra Fase 1/2 pós-submissão, não pra esta semana.

## 1. Inventário de candidatas, com esforço/risco/impacto

| # | Melhoria | Esforço | Risco técnico | Depende de | Impacto | Janela recomendada |
|---|---|---|---|---|---|---|
| 1 | **Paginar `eth_getLogs` + health check do monitor** (issue [#8](https://github.com/JefersonCruz/VILIGION/issues/8), bug) | S (algumas horas) | Baixo — fix localizado em `tempo.adapter.ts`/`monitor.ts`, padrão já usado em outros lugares do engine | Nada | **Alto, imediato**: sem isso, o teste real do canal crítico do Bloco 1 pode falhar silenciosamente numa conta/testnet reiniciada — o próprio erro já reproduzido no log confirma isso | **Agora, antes de terminar o Bloco 1** |
| 2 | **KMS de produção** (issue [#9](https://github.com/JefersonCruz/VILIGION/issues/9)) | M (SDK novo, zona sensível `/privacy`, exige code owner review) | Médio — toca criptografia de dado real | Nada técnico; exige decisão de qual KMS (AWS já é a opção natural, Railway não tem KMS nativo) | Médio — fortalece a história de segurança pros jurados, mas não bloqueia a demo (que não processa dado real) | Fase 1 — fazer antes do primeiro usuário real pagante, não antes disso |
| 3 | **RPC por usuário, hoje é env var compartilhada** (gap em `ARCHITECTURE.md`, **sem issue aberta ainda**) | M | Baixo-médio — precisa de uma coluna nova + UI em `/accounts` ou tela própria | Nada | Baixo agora (1 usuário real no máximo); alto se escalar — vira gargalo de rate-limit de RPC público com múltiplos clientes | Fase 1, só quando houver 2º+ cliente real — abrir issue antes de esquecer |
| 4 | **Calibrar limiares com dado real** (issue [#10](https://github.com/JefersonCruz/VILIGION/issues/10)) | M (precisa de dado, não só código) | Baixo técnico, alto "dado insuficiente" — não dá pra fazer sem histórico de transação real | Fase 1: usuários reais em produção gerando dado | Médio — fortalece pitch "data-driven", mas presets atuais já são razoáveis | Fase 1, condicionado a ter dado — não force antes |
| 5 | **Polimento de UI/responsividade** (issue [#11](https://github.com/JefersonCruz/VILIGION/issues/11)) | S-M | Baixo | Nada | Médio-alto — primeira impressão pro jurado. **Parcialmente já resolvido nesta sessão**: a landing (`/`) foi redesenhada (dark/cyan, animações, diagrama, comparativo) e já está no ar. **Falta**: `/dashboard`, `/accounts`, `/recipients`, `/alerts` continuam no tema claro antigo (consistência visual entre landing nova e painel é uma escolha deliberada, ver sessão anterior — não é bug); responsividade mobile ainda só 2 media queries; logo em PNG base64, não SVG | Se sobrar meio dia antes do prazo: ok fazer o SVG da logo + 1 passada de responsividade. Resto é Fase 1 |
| 6 | **Alerta sonoro/push em tempo real** (issue [#13](https://github.com/JefersonCruz/VILIGION/issues/13)) | L | Médio — exige canal SSE/WebSocket novo que não existe (`dispatchAlert` → navegador), decisão já registrada em `ARCHITECTURE.md` | Nada bloqueante, mas é trabalho de verdade (endpoint + página + sons) | Médio — "nudge" é diferenciação de produto, não crítico | Fase 1/2 — decisão já tomada de tratar como pós-submissão, confirmo que continua certa |
| 7 | **Cobrança on-chain via TIP-20** (Machine Payments Protocol, `BUSINESS-PLAN.md` §1.3) | M-L | Baixo técnico (Tempo já expõe o protocolo nativo); risco real é regulatório/financeiro, não código | **Empresa formalizada** (`BUSINESS-PLAN.md` §3) — não dá pra cobrar sem entidade legal | **Alto** — é o diferenciador de monetização mais específico da Tempo, mas inútil sem clientes pagantes ainda | Fase 2, só depois da formalização + primeiros clientes validados na Fase 1 |
| 8 | ~~Botão de "testar alerta"~~ | — | — | — | **Já construído** (commit `64a6b55`, 2026-10-04: `POST /recipients/test`, botão "Enviar alerta de teste" em `/recipients`) — erro deste documento na primeira versão, corrigido em 2026-10-08. Não entra na priorização abaixo. | — |
| 9 | **Recuperação de conta (senha/TOTP perdido)** (roadmap, sem issue) | M | Médio — qualquer fluxo de recovery é superfície de ataque nova (reset de senha é vetor clássico) | Idealmente o item 12 (login por carteira) — ver nota ali | **Alto antes do primeiro cliente real** — hoje perder o TOTP é lockout permanente, inaceitável pra produção de verdade | Fase 1, prioridade alta — construir junto do item 12, não separado |
| 10 | **Automação de verificação das premissas da Tempo (R&D)** (issue [#12](https://github.com/JefersonCruz/VILIGION/issues/12)) | S-M (script já existe, falta agendar + alertar) | Baixo | Nada | Baixo-médio — reduz risco de o produto parar de funcionar silenciosamente se a Tempo mudar algo da API | Fase 1, barato e vale fazer cedo — stretch antes do prazo só se sobrar tempo depois do item 1 |
| 11 | **Multi-chain (Base/Arbitrum)** (`BUSINESS-PLAN.md` §2, stretch) | M (arquitetura já é núcleo+adaptador, generaliza) | Baixo técnico, risco é "resolve problema que o cliente-alvo atual não tem" (ver `ARCHITECTURE.md`/`BUSINESS-PLAN.md` §1.2 sobre escopo deliberado) | Nada técnico | Alto pro pitch (estratégia multi-track), baixo pro cliente real da Tempo hoje | Só stretch goal pré-prazo **se e somente se** o item 1 e o Bloco 1-4 já estiverem 100% fechados — senão Fase 2 |
| 12 | **Login opcional por carteira (EIP-191), mantendo usuário/senha** (pedido em 2026-10-08, sem issue) | M | Médio-baixo — reaproveita o mesmo padrão já validado em `ownership-proof.ts`; toca `/src/dashboard` e `/src/privacy`, zona sensível (`CODEOWNERS`) | Nada técnico novo | **Alto** — resolve o item 9 (recuperação de conta) de graça: provar a carteira de novo autoriza reconfigurar TOTP, sem fluxo de e-mail separado. Login por senha continua existindo, carteira é opção, não substituição | Fase 1, junto com o item 9 — ver passo a passo no apêndice |

## 2. Prioridade recomendada, em ordem de execução real

1. **Agora, hoje**: item 1 (fix do monitor) — é bug, é rápido, e sem ele o Bloco 1 (teste real do canal crítico) corre risco de dar falso-negativo.
2. **Depois do item 1, ainda esta semana**: voltar pro Bloco 1-4 do `BUSINESS-PLAN.md` — redeploy, teste Twilio real, vídeos, submissão. Nenhum item deste documento entra na frente disso.
3. **Se sobrar meio dia antes do prazo** (improvável, mas documentado): item 5 parcial (SVG da logo) ou item 10 (agendar o script que já existe) — ambos baratos, baixo risco de quebrar algo a poucos dias do prazo.
4. **Primeira sprint pós-submissão (Fase 1)**: itens 9+12 juntos (login por carteira resolve recuperação de conta no mesmo fluxo) — remove fricção real de qualquer usuário de verdade, inclusive os 10-15 entrevistados da Fase 1 (o botão de teste do item 8 já existe, não compete por banda aqui). Depois 2 (KMS) e 3 (RPC por usuário) quando o primeiro cliente real aparecer.
5. **Condicionados a dado/tração real**: item 4 (calibrar limiares) só com uso real acumulado; item 7 (cobrança on-chain) só depois da empresa formalizada e dos primeiros clientes validados.
6. **Baixa prioridade, fazer quando sobrar banda**: itens 6 (nudge sonoro) e 11 (multi-chain) — ambos já tiveram a decisão de "não agora" registrada em `ARCHITECTURE.md`/`BUSINESS-PLAN.md`; este documento só confirma que a decisão continua correta.

## Apêndice — passo a passo: login opcional por carteira (item 12)

Mantém usuário/senha + TOTP como estão; carteira é um método a mais, não substituição. TOTP continua obrigatório mesmo no login por carteira — trocar o 1º fator não elimina o 2º.

1. **Modelo de dados**: tabela `login_challenges` (nonce, address, expiresAt, usado) — schema novo em `privacy/mapping-schema.sql` + versão em memória em `in-memory-repositories.ts`, mesmo padrão de porta dual já usado em todo o projeto.
2. **`privacy/login-challenge.ts`** (novo): mensagem de assinatura distinta da de cadastro (prefixo próprio, ex: "VILIGION - Login por carteira") — pra uma assinatura de login nunca poder ser reaproveitada como prova de cadastro, nem o contrário.
3. **Lookup endereço → usuário**: adicionar `findUserIdByAddress()` ao repositório de `phone_mappings` — hoje essa relação só é escrita no cadastro, nunca consultada de volta.
4. **Duas rotas novas** em `dashboard/server.ts`:
   - `POST /login/wallet/challenge` `{address}` → gera nonce, devolve a mensagem pra assinar (mesmo rate limiter do login hoje).
   - `POST /login/wallet` `{address, signature, nonce}` → verifica assinatura (`viem.verifyMessage`, igual `ownership-proof.ts`), confirma nonce válido/não usado, resolve `userId` — ainda pede o código TOTP antes de abrir sessão.
5. **UI em `/login`**: botão "Entrar com carteira" ao lado do formulário atual — JS cru EIP-1193, mesmo padrão já usado em `signupPage()`, sem bundler novo.
6. **Sessão**: reaproveita `sessions.create()`/cookie HttpOnly existente — nada muda depois do login, só o caminho até ele.
7. **Recovery (fecha o item 9 no mesmo fluxo)**: se o TOTP também tiver sido perdido, login por carteira bem-sucedido abre uma tela de "reconfigurar TOTP" (novo QR) — sem precisar de fluxo de e-mail separado, que seria uma superfície de ataque nova.
8. **Testes**: espelhar `ownership-proof.test.ts` (assinatura válida/forjada/nonce reutilizado/expirado) + smoke test curl, como os outros fluxos EIP-191 do projeto.
9. **Review**: toca `/src/dashboard` e `/src/privacy` — exige aprovação de code owner (`CODEOWNERS`), além da geral.

## 3. O que este documento não tenta resolver

Validação de mercado (quantas PMEs têm tesouraria TIP-20 na Tempo hoje), modelo de preço exato, e formalização da empresa já estão em `BUSINESS-PLAN.md` §1 e §3 — não duplicado aqui. Este documento assume aquelas decisões como dadas e só avalia viabilidade técnica/produto de cada melhoria candidata.
