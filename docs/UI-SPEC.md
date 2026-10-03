# Especificação de Interface — Portal VILIGION

> Documento de planejamento técnico. Define estrutura, não implementa — consistente com a decisão já tomada de não construir a camada HTTP/UI antes do prazo de submissão (ver `ARCHITECTURE.md` → "Architecture gaps"). Serve de referência pronta pra quando isso for construído.

## 1. Linguagem e stack

**Decisão: TypeScript em todas as camadas, servidor renderiza HTML, sem framework de frontend pesado.**

Justificativa — consistência com o que já existe, não preferência isolada:
- O backend inteiro já é TypeScript puro, sem framework (`node:http` cru, nem Express) — ver `dashboard/server.ts`, `webhook-server.ts`. Trazer React/Vue pro frontend quebraria esse padrão de minimalismo deliberado por uma complexidade (bundler, build step, state management) que o projeto não tem em nenhum outro lugar.
- TypeScript no frontend permite **reusar os tipos já existentes** direto do backend (`AccountDetails`, `DetectionEvent`, `MonitoredAccountRow`) sem duplicar contrato de API.
- HTML renderizado pelo servidor (não SPA) é a opção mais rápida de construir corretamente num hackathon, não exige bundler, e serve bem o público-alvo (dono de PME, não precisa de app-like UX sofisticada).

**Quando reconsiderar**: se o painel precisar de atualização em tempo real (ex: o "nudge" de som/vibração já avaliado e adiado), aí uma camada leve de JS no cliente (sem framework, só `EventSource` pra SSE) resolve sem precisar de SPA completa.

## 2. Inventário de telas

| # | Tela | Propósito | Endpoint(s) que usa | Status do backend |
|---|---|---|---|---|
| 1 | **Cadastro** | Provar posse do endereço (assinatura), registrar telefone virtual, escolher chain + token a monitorar, definir limiares | `POST /signup` (novo) | Lógica pronta (`PhoneMappingService`, `ownership-proof.ts`), **endpoint não existe** |
| 2 | **Login** | Usuário + senha + código TOTP | `POST /login` | **Já existe**, só falta a tela |
| 3 | **Painel principal** | Saldo atual, status dos canais de alerta, lista de contas monitoradas | `GET /details` | **Já existe** (API), só falta a tela |
| 4 | **Histórico de alertas** | Lista de alertas disparados, severidade, canal usado, status do PIN | `GET /alerts` (novo, ou estender `/details`) | `PostgresAlertLog.recentForUser` já existe, **endpoint não existe** |
| 5 | **Gerenciar contas monitoradas** | Adicionar/remover chain+token a monitorar (qualquer chain EVM-compatível já suportada) | `POST /accounts`, `GET /accounts`, `DELETE /accounts/:id` (novos) | `PostgresMonitoredAccountRepository` já existe, **endpoints não existem** |
| 6 | **Configurar limiares** | Ajustar `maxBalanceDropPct`/`criticalBalanceDropPct` etc. por conta | `PUT /thresholds` (novo) | Schema existe (`user_thresholds`), **endpoint não existe** |

Não incluído de propósito (fora de escopo, ver decisões já registradas): tela de pagamento/cobrança (modelo de negócio ainda não implementado), tela de múltiplas chains não-EVM ou exchanges (escopo descartado), app nativo/PWA (roadmap adiado).

## 3. Fluxo de cadastro/portal, de ponta a ponta

```
1. GET  /signup              → formulário: endereço, nonce gerado, campo de assinatura
2. POST /signup               body: { address, nonce, signature, virtualPhoneNumber }
   → PhoneMappingService.register() valida assinatura (ownership-proof.ts)
   → PostgresPhoneMappingRepository.save() grava, retorna userId (= phone_mappings.id)
   → cria DashboardUser com ESSE MESMO userId (unifica identidade - ver nota abaixo)
   → retorna credenciais de login (username, senha gerada, QR code TOTP) - exibidas UMA VEZ

3. POST /login                body: { username, password, totpCode }
   → retorna token de sessão (já existe)

4. POST /accounts             body: { chainKey, tokenAddress, watchedAddress }  [autenticado]
   → valida chainKey via getKnownChain() (known-chains.ts)
   → PostgresMonitoredAccountRepository.add()

5. PUT /thresholds             body: { maxBalanceDropPct, criticalBalanceDropPct, ... } [autenticado]

6. index.ts, no boot:
   → monitoredAccounts.listAll() lê TODAS as contas de TODOS os usuários
   → agrupa por chainKey, sobe um Monitor por conta (reusa EvmAdapter/TempoAdapter já existentes)
   → cada Monitor usa os thresholds daquele usuário
```

### Decisão de design pendente, não só código faltando

`monitored_accounts.user_id` e `alert_log.user_id` já referenciam `phone_mappings.id` no schema. Pra isso funcionar com o login do painel, `DashboardUser.userId` (hoje gerado solto em `InMemoryUserRepository.createDemoUser`) precisa ser **o mesmo UUID** de `phone_mappings.id` — ou seja, o cadastro (passo 2 acima) tem que criar as duas coisas juntas, com o mesmo id, numa transação. Isso é a peça que faltava pra fechar a lacuna identificada em `ARCHITECTURE.md`.

## 4. Prioridade de construção, se/quando isso for pra frente

1. `POST /signup` unificado (maior valor — sem ele, nenhuma tela faz sentido com dado real)
2. Tela de login + painel principal (reusa endpoints que já existem)
3. `POST/GET/DELETE /accounts` + tela de gerenciar contas
4. `PUT /thresholds` + tela de configuração
5. `GET /alerts` + tela de histórico

Cada item é independente — dá pra construir e entregar em qualquer ordem sem quebrar o anterior.
