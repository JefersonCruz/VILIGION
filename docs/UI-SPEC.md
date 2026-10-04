# Especificação de Interface — Portal VILIGION

> **Status: construído em 2026-10-03** (as rotas reais são `GET/POST /signup`, `GET /login`, `POST /session`, `GET /dashboard`, `GET/POST /accounts`, `POST /accounts/:id/delete`, `GET/POST /thresholds`, `GET/POST /recipients`, `POST /recipients/:id/delete`, `GET /alerts`, `GET /logout` — os nomes de endpoint abaixo nas seções 2–3 eram o plano original e diferem um pouco dos nomes finais; ver `ARCHITECTURE.md` → "Portal"/"Recipients" pro resumo do que existe de verdade). Validado por smoke test real (curl + assinatura EIP-191 de verdade via viem), não só typecheck. Documento original de planejamento preservado abaixo como referência de design.

## 1. Linguagem e stack

**Decisão: TypeScript em todas as camadas, servidor renderiza HTML, sem framework de frontend pesado.**

Justificativa — consistência com o que já existe, não preferência isolada:
- O backend inteiro já é TypeScript puro, sem framework (`node:http` cru, nem Express) — ver `dashboard/server.ts`, `webhook-server.ts`. Trazer React/Vue pro frontend quebraria esse padrão de minimalismo deliberado por uma complexidade (bundler, build step, state management) que o projeto não tem em nenhum outro lugar.
- TypeScript no frontend permite **reusar os tipos já existentes** direto do backend (`AccountDetails`, `DetectionEvent`, `MonitoredAccountRow`) sem duplicar contrato de API.
- HTML renderizado pelo servidor (não SPA) é a opção mais rápida de construir corretamente num hackathon, não exige bundler, e serve bem o público-alvo (dono de PME, não precisa de app-like UX sofisticada).

Confirmado na prática: a única página com JavaScript no cliente é `/signup` (`dashboard/views.ts#signupPage`), e usa EIP-1193 cru (`window.ethereum.request`) pra conectar carteira e assinar — sem viem/ethers no navegador, sem bundler.

**Quando reconsiderar**: se o painel precisar de atualização em tempo real (ex: o "nudge" de som/vibração já avaliado e adiado), aí uma camada leve de JS no cliente (sem framework, só `EventSource` pra SSE) resolve sem precisar de SPA completa.

## 2. Inventário de telas

| # | Tela | Propósito | Rota real |
|---|---|---|---|
| 1 | **Cadastro** | Provar posse do endereço (assinatura), criar usuário/senha do painel | `GET/POST /signup` |
| 2 | **Login** | Usuário + senha + código TOTP, sessão por cookie HttpOnly | `GET /login`, `POST /session` |
| 3 | **Painel principal** | Saldo atual, contagem de contas monitoradas, últimos alertas | `GET /dashboard` |
| 4 | **Histórico de alertas** | Lista de alertas disparados, severidade, canal usado, status do PIN | `GET /alerts` |
| 5 | **Gerenciar contas monitoradas** | Adicionar/remover chain+token a monitorar (qualquer chain EVM-compatível já suportada) | `GET/POST /accounts`, `POST /accounts/:id/delete` |
| 6 | **Configurar limiares** | Ajustar os limiares normal/crítico de queda de saldo e transferência bloqueada | `GET/POST /thresholds` |
| 7 | **Destinatários de alerta** | Cadastrar/remover telefones (canal crítico, ligação) e e-mails (canal normal) por usuário | `GET/POST /recipients`, `POST /recipients/:id/delete` |

A API JSON original (`POST /login`, `GET /details`, Bearer token) continua existindo sem mudança, pra consumidor programático — as páginas HTML usam cookie de sessão, não essa API.

Não incluído de propósito (fora de escopo, ver decisões já registradas): tela de pagamento/cobrança (modelo de negócio ainda não implementado), tela de múltiplas chains não-EVM ou exchanges (escopo descartado), app nativo/PWA (roadmap adiado).

## 3. Fluxo de cadastro/portal, de ponta a ponta (como funciona de verdade)

```
1. GET  /signup                → formulário com nonce gerado no servidor (randomBytes)
                                  JS no navegador conecta a carteira (window.ethereum),
                                  monta a MESMA mensagem de ownership-proof.ts e assina

2. POST /signup                 body (form): address, nonce, signature, username, password
   → SignupService.signup():
     - rejeita username já existente ANTES de verificar assinatura
     - PhoneMappingService.register() valida a assinatura (ownership-proof.ts) - não coleta telefone, só ancora identidade (ver nota 2026-10-03 abaixo)
     - PhoneMappingStore.save() grava o registro de posse criptografado, retorna userId (= phone_mappings.id)
     - DashboardUserStore.create() cria o login com ESSE MESMO userId (identidade unificada)
     - ThresholdsStore.upsert() grava limiares padrão
   → página de sucesso mostra usuário + otpauth:// (configurar no autenticador) - exibido UMA VEZ

3. POST /session                body (form): username, password, totpCode
   → valida, cria sessão, Set-Cookie HttpOnly, redireciona pra /dashboard

4. GET/POST /accounts            [autenticado via cookie]
   → valida chainKey via getKnownChain() (known-chains.ts) ANTES de gravar
   → MonitoredAccountsPort.add()/listForUser()/remove()

5. GET/POST /thresholds          [autenticado]

6. index.ts, no boot (modo com DATABASE_URL):
   → monitoredAccounts.listAll() lê TODAS as contas de TODOS os usuários
   → um Monitor por linha (TempoAdapter se chainKey==="tempo", EvmAdapter genérico pras outras)
   → cada Monitor usa os thresholds daquele usuário (ou um default se ainda não configurou)
```

### Decisão de design que estava pendente - resolvida

`monitored_accounts.user_id` e `alert_log.user_id` referenciam `phone_mappings.id` no schema. `SignupService` agora garante que `dashboard_users.user_id` é **o mesmo UUID** — criado numa sequência (não transação SQL formal, ver nota em `signup-service.ts`) dentro de `signup()`. Fecha a lacuna que estava documentada em `ARCHITECTURE.md`.

### Dois backends, mesmo código

`SignupService` e as rotas de `dashboard/server.ts` dependem de **portas** (`PhoneMappingStore`, `DashboardUserStore`, `ThresholdsStore`, `MonitoredAccountsPort`, `AlertHistoryPort`), não de classes concretas. `index.ts` escolhe a implementação por `DATABASE_URL`:
- **Com banco**: `db/postgres-repositories.ts` (Postgres de verdade).
- **Sem banco** (modo demo): `dashboard/in-memory-repositories.ts` (tudo em memória, zero dependência externa pra rodar local).

## 4. O que ficou de fora desta rodada (próximo passo real, não esta)

- RPC override por usuário ainda vem de env var compartilhada, não cadastrado por usuário. (Destinatários de alerta — telefone/e-mail — já foram migrados pra `/recipients`, ver `ARCHITECTURE.md` → "Recipients".)
- `classifyBalanceDelta` (fee vs. valor real) continua stub — ver `ARCHITECTURE.md`.
- Nenhum KeyProvider de KMS real — `LocalDevKeyProvider` em produção é um gap aceito e documentado.
- Validação de formulário é só o mínimo (campos obrigatórios, chain conhecida) — sem validação de formato de endereço/telefone no servidor ainda.
