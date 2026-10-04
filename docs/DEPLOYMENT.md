# Guia de Deploy — VILIGION

> Passo a passo pra colocar o sistema no ar de verdade: hospedagem, banco de dados, variáveis de ambiente. Host recomendado: **Railway** (mesma plataforma pro app e pro Postgres — uma conta, uma fatura, `DATABASE_URL` pronto sem configurar nada à mão). Alternativas (Render, Fly.io, Neon, Supabase) funcionam também, mas os passos abaixo são específicos da Railway.
>
> **Já executado de verdade em 2026-10-03** — não é só teoria. Projeto no ar em `https://viligion-app-production.up.railway.app`, testado com curl contra o domínio público (login, cadastro, dashboard, webhook todos respondendo). Os passos abaixo refletem o que realmente aconteceu, incluindo um obstáculo real (Passo 6) que não estava previsto na primeira versão deste guia.

## Antes de começar — o que o sistema expõe

O processo sobe **um único servidor HTTP** (`PORT`, default 3000) atendendo webhook da Twilio e painel juntos — tentando a rota de webhook primeiro, caindo pro painel se não bater (ver `webhook-server.ts#handleWebhookRequest` e `dashboard/server.ts#createDashboardRequestHandler`). Isso foi uma correção deliberada: a versão original rodava dois `http.Server` em portas separadas, mas a Railway (confirmado na prática, não só na doc) só libera **um domínio público por serviço** via `railway domain` — então uma porta e um domínio é o que de fato funciona sem truque.

## Passo 1 — Criar o projeto e o banco na Railway

1. Entre em [railway.com](https://railway.com), crie um projeto novo.
2. Dentro do projeto: **+ New → Database → PostgreSQL**. A Railway provisiona o banco e já expõe `DATABASE_URL` como variável do serviço do Postgres.

## Passo 2 — Conectar o repositório

1. No mesmo projeto: **+ New → GitHub Repo**, autorize e selecione `JefersonCruz/VILIGION`, branch `master`.
2. A Railway detecta Node.js automaticamente (Nixpacks) e usa `npm run build` + `npm start` (scripts já existem no `package.json` — `start` foi adicionado agora, rodava só `tsx watch`, que não serve pra produção).

## Passo 3 — Ligar o serviço do app ao banco

No serviço do app (não no do Postgres): **Variables → New Variable → Add Reference** → selecione `DATABASE_URL` do serviço Postgres. Isso cria uma referência (`${{Postgres.DATABASE_URL}}`) que se atualiza sozinha se a credencial do banco mudar — não precisa copiar/colar a connection string.

## Passo 4 — Variáveis de ambiente

Preencha no serviço do app, baseado no `.env.example`. Mínimo pra funcionar:

```
# Tempo (valores confirmados contra a rede real - ver .env.example)
TEMPO_RPC_URL=https://rpc.tempo.xyz
TEMPO_CHAIN_ID=4217

# Privacidade - OBRIGATÓRIO definir uma chave fixa, senão o processo gera
# uma nova a cada deploy e qualquer cadastro anterior fica ilegível
ENCRYPTION_KEY_KMS_ARN=<gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

# App
PORT=3000
PUBLIC_BASE_URL=https://<domínio público gerado no Passo 5>

# Twilio e SMTP - opcionais (ver ARCHITECTURE.md sobre por quê), preencher quando configurar
```

`DATABASE_URL` não entra na lista — já veio do Passo 3.

## Passo 5 — Gerar o domínio público

**Settings → Networking → Public Networking → Generate Domain** (ou `railway domain --service <nome-do-serviço> --port 3000`). Anote o domínio gerado (ex: `viligion-app-production.up.railway.app`) e preencha `PUBLIC_BASE_URL` no Passo 4 com `https://` + esse domínio — tanto o webhook (assinatura da Twilio) quanto o painel ficam atrás dele.

## Passo 6 — Rodar a migration

Schema em `privacy/mapping-schema.sql`, aplicado via `scripts/migrate.ts`. Rode da sua máquina, contra o banco já hospedado:

```bash
npm install -g @railway/cli   # uma vez só
railway login
railway link                  # escolhe o projeto que você criou
railway run npm run migrate
```

⚠️ **Isso não funciona direto** — testado na prática: `${{Postgres.DATABASE_URL}}` resolve pro hostname **privado** da Railway (`postgres.railway.internal`), que só existe dentro da rede da própria Railway. Rodando `railway run` da sua máquina local, a conexão falha com `ENOTFOUND postgres.railway.internal`. Pra migrar de fora, crie um proxy TCP temporário no serviço do Postgres:

```bash
railway tcp-proxy create --service Postgres --port 5432 --json
# devolve um endpoint tipo "algumacoisa.proxy.rlwy.net:PORTA"
```

Pegue `PGUSER`/`PGPASSWORD`/`PGDATABASE` em `railway variable list --service Postgres --json`, monte `postgresql://PGUSER:PGPASSWORD@<endpoint-do-proxy>/PGDATABASE`, e rode a migration com essa URL:

```bash
DATABASE_URL="postgresql://..." npx tsx scripts/migrate.ts
```

**Depois, apague o proxy** (`railway tcp-proxy delete <porta> --service Postgres --yes`) — ele expõe o Postgres direto pra internet, só serve pra essa tarefa pontual. O app em produção continua usando a rede privada normalmente.

Depois de rodar a migration, se o deploy já tinha subido antes (e crashado tentando ler uma tabela que ainda não existia), dispare um redeploy manual: `railway redeploy --service <nome> --yes`.

## Passo 7 — Testar de verdade

1. Abra `https://<domínio gerado no Passo 5>/signup` no navegador.
2. Conecte uma carteira (MetaMask), assine a prova de propriedade, complete o cadastro.
3. Configure o autenticador com o QR/código mostrado uma única vez.
4. Faça login em `/login`, confira o painel em `/dashboard`.
5. Em `/accounts`, adicione a conta que quer monitorar (chain + token + endereço) — o monitor sobe na hora, não precisa reiniciar nada (ver nota abaixo).

## Notas importantes

- **Contas novas já são monitoradas na hora** (corrigido em 2026-10-04, ver `ARCHITECTURE.md` → "Registro dinâmico de monitor") — cadastrar uma conta em `/accounts` sobe o `Monitor` dela imediatamente, sem precisar de redeploy. Só o passo 6 (rodar a migration pela primeira vez) ainda exige intervenção manual, igual antes.
- **KMS real ainda não existe** (ver `ARCHITECTURE.md`) — `LocalDevKeyProvider` com a chave fixa do Passo 4 é aceitável pra validar o sistema funcionando, mas não é o que se usaria com dado de cliente real em produção de verdade.
- **Twilio**: configure a conta e preencha as variáveis quando for testar o canal crítico. Até lá, alertas críticos só logam no console (comportamento já documentado).
- **Custo esperado**: ~US$10-11/mês de infra fixa, já validado com preços reais de mercado (ver `docs/BUSINESS-PLAN.md`).
