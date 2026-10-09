# Playbook do time — papéis, comunicação e ferramentas

> Pra quem entrou agora no VILIGION: o que você faz, onde vê o estado real do projeto, por quais canais a gente fala e o que **nunca** se pede por eles. Última revisão: 2026-10-09.

## 0. O que NÃO está aqui (pra não duplicar e desencontrar)

Este documento é sobre **pessoas e processo**. O resto já existe e continua sendo a fonte:

| Pergunta | Onde |
|---|---|
| Como rodar, clonar, configurar `.env` | [issue #1 — Onboarding](https://github.com/JefersonCruz/VILIGION/issues/1) |
| Regras técnicas de contribuição, zonas sensíveis, review | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Como o sistema funciona por dentro | [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Modelo de ameaça (leia antes de tocar em `/privacy` ou `/alerts`) | [`SECURITY.md`](../SECURITY.md) |
| Quem decide o quê nesta fase | [`GOVERNANCE.md`](../GOVERNANCE.md) |
| Premiação, equity, assinatura | Acordo de Colaborador — **documento privado**, o fundador compartilha o link individualmente |

## 1. Onde ver a evolução do projeto (sem perguntar a ninguém)

Nenhum destes é "relatório que alguém escreve pra você" — todos são mantidos junto com o trabalho, então não desatualizam em silêncio:

- **O que está pronto, o que falta e qual é o maior risco agora** → [`docs/BUSINESS-PLAN.md`](./BUSINESS-PLAN.md) §0 e §6. É o documento mais atualizado do projeto; §6 tem o checklist real até a submissão.
- **O que construir a seguir e por quê (esforço × risco × impacto, item a item)** → [`docs/PRODUCT-FEASIBILITY.md`](./PRODUCT-FEASIBILITY.md).
- **Por que as telas são como são, e o que melhorar nelas** → [`docs/UI-DESIGN-STUDY.md`](./UI-DESIGN-STUDY.md).
- **O que mudou no código esta semana** → `git log --oneline -20`. As mensagens de commit aqui explicam *por quê*, não só *o quê* — dá pra reconstruir a história lendo só elas.
- **O que está quebrado ou pendente** → [issues abertas](https://github.com/JefersonCruz/VILIGION/issues). Issue com label `good first issue` é ponto de entrada seguro.
- **Se a produção está de pé** → https://viligion.com e o painel da Railway.

**Ritual mínimo enquanto o hackathon não acaba**: uma mensagem curta por dia no canal do time — o que fiz, o que vou fazer, onde travei. Não precisa de reunião; travar em silêncio é o único erro caro num time pequeno com prazo.

## 2. Papéis — o que faz sentido fazer AGORA (até 12/10)

Seja honesto sobre o calendário: faltam poucos dias e o caminho crítico é **disparar um alerta real, gravar dois vídeos e submeter**. Isso está descrito no §6 do plano de negócio e depende de credenciais e da conta do fundador — não é delegável.

Então, pra quem entra agora, o trabalho de maior valor **não é código no caminho crítico** (ramp-up custa mais que entrega a 3 dias do prazo). É isto:

**Testar como usuário de verdade e relatar fricção.** Crie uma conta em https://viligion.com, passe por cadastro → carteira → TOTP → adicionar conta → limiares → destinatários. Cada lugar onde você hesitou vira uma issue. Isso é alto valor e risco zero: você não quebra nada e encontra o que quem construiu já não enxerga.

**Issues sem caminho crítico**, se quiser mexer em código: [#11 (polimento de UI, `good first issue`)](https://github.com/JefersonCruz/VILIGION/issues/11) e [#12 (automatizar verificação das premissas da Tempo)](https://github.com/JefersonCruz/VILIGION/issues/12). Nenhuma das duas bloqueia a submissão, então um PR que demore não trava ninguém.

**Preparar a Fase 1 em paralelo** (ver §2 do plano de negócio): a lista de espera já tem inscritos, com o campo de "o que mais te preocupa" preenchido por eles. Transformar isso num roteiro de 10–15 entrevistas é trabalho que não depende do prazo e é o que separa "projeto de hackathon" de empresa.

**O que NÃO pegar agora**: qualquer coisa em `/src/privacy`, `/src/alerts` ou `/src/dashboard` sem combinar antes. São zonas sensíveis (exigem revisão de code owner, ver `CODEOWNERS`), e um PR grande aí no meio da semana da submissão atrapalha mais do que ajuda.

## 3. Papéis depois do hackathon

`GOVERNANCE.md` já define dois papéis técnicos com problema concreto dono (**R&D Agent** — manter as premissas sobre a Tempo em dia; **Cientista de Dados** — calibrar limiares com dado real). O terceiro, ainda sem dono, é **GTM/prospecção**, que é sobre o que fala a seção seguinte.

## 4. Canais e a política que vale em todos

O VILIGION existe porque ligar um telefone a um saldo on-chain é perigoso. Um canal de comunicação descuidado reproduz exatamente esse risco — então a regra abaixo não é burocracia, é o produto sendo coerente consigo mesmo.

| Canal | Pra que serve | O que nunca acontece ali |
|---|---|---|
| **GitHub (issues/PR)** | Trabalho técnico, decisão registrada | Credencial, valor real de `.env`, dado de cliente |
| **Telegram** — [@viligionOficial](https://t.me/viligionOficial) | Inbound de interessado, suporte inicial, conversa do time | Endereço, saldo, valor, seed, código TOTP |
| **X/Twitter** — [@viligion](https://x.com/viligion) | Só difusão: anúncio, conteúdo, bastidor | **Nenhum atendimento de caso** — resposta pública identifica a pessoa como dona de tesouraria |
| **E-mail** | Lista de espera, contato formal, entrevistas da Fase 1 | Igual aos demais: nada de endereço/saldo |
| **Painel autenticado** | O único lugar onde saldo e endereço reais aparecem | — |

**As cinco regras, curtas o bastante pra decorar:**

1. **Nunca pedimos endereço, saldo, seed ou código TOTP** — por canal nenhum, por motivo nenhum. Se alguém pedindo isso disser que é do VILIGION, é golpe.
2. **Nunca mandamos DM primeiro.** Quem fala com a gente, fala porque procurou.
3. **Caso específico sai do canal público.** No Twitter, a resposta é sempre "te chamo no privado" ou "entra em contato pelo site" — nunca discutir a situação ali.
4. **Dúvida sobre a tesouraria dele é no painel**, com a pessoa autenticada. Suporte não confirma nem nega informação de conta por mensagem.
5. **Impersonação é o golpe padrão em cripto.** Os canais oficiais são **[@viligion](https://x.com/viligion)** no X e **[@viligionOficial](https://t.me/viligionOficial)** no Telegram, e estão publicados no rodapé de https://viligion.com pra qualquer um conferir. Qualquer outro perfil usando o nome não é nosso.

**Acesso por papel** — quem faz prospecção/suporte **não recebe acesso de produção**. O painel e o banco guardam o vínculo contato↔endereço (criptografado, mas existe); trabalho de GTM não precisa dele pra nada, e todo acesso a mais é superfície de ataque a mais. Acesso de escrita no GitHub é separado de acesso à Railway: ter um não dá o outro.

## 5. Ferramentas que já existem no projeto

Antes de construir qualquer coisa, veja se não está pronto:

| Comando / recurso | Pra quê |
|---|---|
| `npm run dev` | Sobe tudo local. Sem `DATABASE_URL` roda em modo demo, com repositórios em memória — zero dependência externa. |
| `npm test` | 187 testes. Tem que estar verde antes de qualquer PR. |
| `npx tsx scripts/verify-testnet.ts` | Confere RPC, chain ID, endereço do `ReceivePolicyGuard` e decodifica um `TransferBlocked` real na testnet. É a prova de que não é simulação. |
| `npx tsx scripts/migrate.ts` | Aplica o schema no Postgres (ver `docs/DEPLOYMENT.md`, passo 6 — de fora da Railway exige proxy TCP). |
| `npx tsx scripts/verify-contributor-signature.ts` | Verifica assinatura EIP-191 do acordo de colaborador. |
| Botão **"Enviar alerta de teste"** em `/recipients` | Exercita o canal crítico de ponta a ponta sem esperar anomalia real na chain. |
| `/admin/waitlist` | Exporta os inscritos da lista de espera em JSON (precisa de `WAITLIST_ADMIN_TOKEN`). Matéria-prima da prospecção. |
| Railway CLI (`railway status`, `railway logs`) | Estado e log de produção, pra quem tiver acesso. |

## 6. Como pegar e entregar trabalho

1. Comente na issue dizendo que vai pegar (evita dois fazendo o mesmo).
2. Branch a partir de `master`, PR pra `master` — a branch é protegida: PR obrigatório, CI (`build-and-test`) verde, 1 aprovação, e code owner nos caminhos sensíveis.
3. Mensagem de commit explica **por que**, não só o quê — é o padrão do repo e o que faz o histórico servir de documentação.
4. Mexeu em `/privacy` ou `/alerts`? O PR precisa dizer explicitamente como a mudança preserva cada item da tabela do `SECURITY.md`.
5. Travou? Diz no canal no mesmo dia.
