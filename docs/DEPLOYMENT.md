# Guia de Deploy — VILIGION

> Passo a passo pra colocar o sistema no ar de verdade: hospedagem, banco de dados, variáveis de ambiente. Host recomendado: **Railway** (mesma plataforma pro app e pro Postgres — uma conta, uma fatura, `DATABASE_URL` pronto sem configurar nada à mão). Alternativas (Render, Fly.io, Neon, Supabase) funcionam também, mas os passos abaixo são específicos da Railway.

## Antes de começar — o que o sistema expõe

O processo sobe **dois servidores HTTP** ao mesmo tempo, em portas diferentes:
- **Webhook** (`PORT`, default 3000) — recebe a confirmação de PIN da Twilio. Precisa ser público.
- **Painel** (`DASHBOARD_PORT`, default `PORT+1`) — cadastro, login, dashboard. Precisa ser público.

Confirmei que a Railway suporta isso sem nenhuma mudança de código: dá pra gerar **dois domínios públicos no mesmo serviço**, cada um apontando pra uma porta interna diferente ("Target Ports"/"Magic Ports", disponível no runtime V2). Não precisa separar em dois serviços.

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
DASHBOARD_PORT=3001
PUBLIC_BASE_URL=https://<domínio público do webhook, ver Passo 5>

# Twilio e SMTP - opcionais (ver ARCHITECTURE.md sobre por quê), preencher quando configurar
```

`DATABASE_URL` não entra na lista — já veio do Passo 3.

## Passo 5 — Gerar os dois domínios públicos

1. **Settings → Networking → Public Networking → Generate Domain.**
2. A Railway pergunta qual porta — escolha `3000` (webhook). Anote o domínio gerado (ex: `viligion-production.up.railway.app`).
3. Clique em **Generate Domain** de novo, desta vez escolha `3001` (painel). Fica um segundo domínio, só pro painel.
4. Volte no Passo 4 e preencha `PUBLIC_BASE_URL` com `https://` + o domínio da porta 3000 (o webhook precisa saber sua própria URL pública pra Twilio assinar corretamente).

## Passo 6 — Rodar a migration

Schema em `privacy/mapping-schema.sql`, aplicado via `scripts/migrate.ts`. Rode da sua máquina, contra o banco já hospedado:

```bash
npm install -g @railway/cli   # uma vez só
railway login
railway link                  # escolhe o projeto que você criou
railway run npm run migrate
```

`railway run` injeta as variáveis do ambiente da Railway (inclusive `DATABASE_URL`) no comando rodado localmente — não precisa copiar a connection string pra mão.

## Passo 7 — Testar de verdade

1. Abra `https://<domínio da porta 3001>/signup` no navegador.
2. Conecte uma carteira (MetaMask), assine a prova de propriedade, complete o cadastro.
3. Configure o autenticador com o QR/código mostrado uma única vez.
4. Faça login em `/login`, confira o painel em `/dashboard`.
5. Em `/accounts`, adicione a conta que quer monitorar (chain + token + endereço).
6. **Reinicie o deploy** (redeploy manual na Railway) — isso faz o `index.ts` reler `monitored_accounts` do banco e subir um monitor pra conta que você acabou de cadastrar.

## Notas importantes

- **O monitor só lê contas novas no boot.** Cadastrar uma conta não sobe o monitor dela na hora — precisa reiniciar o processo (redeploy ou restart manual). Isso é comportamento atual, não bug: `index.ts` lê `monitored_accounts.listAll()` uma vez, no startup.
- **KMS real ainda não existe** (ver `ARCHITECTURE.md`) — `LocalDevKeyProvider` com a chave fixa do Passo 4 é aceitável pra validar o sistema funcionando, mas não é o que se usaria com dado de cliente real em produção de verdade.
- **Twilio**: configure a conta e preencha as variáveis quando for testar o canal crítico. Até lá, alertas críticos só logam no console (comportamento já documentado).
- **Custo esperado**: ~US$10-11/mês de infra fixa, já validado com preços reais de mercado (ver `docs/BUSINESS-PLAN.md`).
