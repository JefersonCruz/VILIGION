# Pacote de submissão — Crypto World's Fair (Colosseum), trilha Tempo

> **Prazo:** `2026-10-13T06:59:00Z` — 12/10, 23:59 PT.
> **Para quê:** colar nos campos do formulário. Os textos em inglês abaixo são **rascunho estrutural** — reescreva na sua voz antes de enviar. Jurado lê esses campos como as palavras do time, e um texto que soa gerado conta contra em "Founder Communication".
> **Regra:** toda frase aqui é verificável no repositório ou no produto no ar. Se você mudar alguma, mantenha isso verdadeiro.

> **Ponto exato do que foi submetido:** tag `submissao-colosseum-2026-10-13`, commit `54c586d` (2026-10-13 01:34Z) — o ultimo dentro da janela, que fechou as 06:59Z. O jurado confere com `git checkout submissao-colosseum-2026-10-13`. O unico commit posterior na master e o acesso de avaliacao (`e6cf513`), que nao acrescenta capacidade de produto e esta declarado no topo do README.

## Estado verificado em 2026-10-13 00:20Z

| Item | Estado |
|---|---|
| Testes | **378 em 40 arquivos**, CI verde |
| Lint | **0 erro**, 32 avisos (cada um justificado em `eslint.config.js`) |
| Produção | `viligion.com` no ar, deploy `f17bd3f8` SUCCESS, rodando a `master` (`2fec128`) |
| Canal crítico — ligação | Ativo (Twilio) |
| Canal crítico — push, sem telefone | Ativo e **comprovado em dispositivo real** |
| Canal normal — e-mail | **NÃO configurado** (SMTP ausente, só loga) |
| PWA | Instalável (manifest 128/192/512, SW com handler de fetch) |
| Monitor | 1 conta, chain Tempo, boot sem erro de ciclo |
| Commits | **81**, primeiro em 2026-10-02, **nenhum antes de 14/09** |

> **Atenção, `www`:** `https://viligion.com` responde 200, mas **`www.viligion.com` responde 404** — o plano da Railway permite um domínio customizado por serviço, já ocupado pelo apex, então o `www` não tem destino. Use sempre a URL **sem `www`** no formulário e no vídeo. Correção (2 min, na Cloudflare, onde o DNS está): Redirect Rule de `www.viligion.com/*` para `https://viligion.com/$1`, 301.

> **O que mudou desde a verificação anterior (12/10, 04:30Z):** a contagem de testes subiu de 248 para 378, e a produção passou a rodar a `master`. O deploy anterior (`a8230ac3`) não tinha duas correções que importam numa demo ao vivo: um caminho em que uma requisição HTTP malformada **encerrava o processo** — e com ele todos os monitores, sem alerta nenhum avisando — e um bug em que um único bloqueio de transferência gerava **cinco ligações** pelo mesmo evento. As duas estão no ar agora.

---

## Campo: nome

```
VILIGION
```

## Campo: descrição curta (~50 palavras)

> VILIGION watches TIP-20 treasuries on Tempo and reaches the owner by real phone call when something critical happens — not a dashboard they have to stare at. It also delivers the same critical alert with no phone number involved at all, because linking a number to on-chain funds is itself a physical-security risk.

## Campo: descrição completa (~280 palavras)

> A business owner holding stablecoin on Tempo has two bad options: watch a dashboard all day, or find out late. Institutional monitoring (Chainalysis/Hexagate, Elliptic, TRM Labs) is built for security teams with >$50k ACVs. Call-based alerting exists for individuals, but isn't designed against the threat that matters here.
>
> That threat is physical. Coercion attacks tied to crypto ownership ("wrench attacks") are documented and growing: CertiK verified 52 incidents in H1 2026, **33% more incidents** than H1 2025, with $124.1M in recorded financial exposure; Chainalysis, using a narrower measure, counted 46 incidents and over $30M actually stolen. Two different methodologies, same conclusion: the moment you connect a phone number to a treasury balance, the alert channel becomes an attack surface.
>
> So we built the alert channel twice. A critical anomaly goes out by **phone call** (Twilio Voice) with a single-use confirmation PIN — and, if the owner registered a device, by **Web Push with no phone number anywhere in the path**. A phone number is attributable to a person and its retention is regulatory, not a vendor setting; a push endpoint is an opaque address the browser issues and the owner can revoke. The privacy property comes from the data not existing, not from stronger encryption.
>
> Detection reads TIP-20 balances over RPC (Viem), adjusting for Tempo's fee token so a transaction fee is never mistaken for a loss, and decodes real `TransferBlocked` events from `ReceivePolicyGuard`/TIP-403 using `ox/tempo`.
>
> Alert content never contains balance or address — enforced by automated test, not review. The owner then answers one question in the dashboard: **"was this you?"** That answer, not the PIN, is the signal the product exists to capture.
>
> 378 automated tests, no external audit yet. MIT, public repo.

## Campo: go-to-market (~160 palavras)

> Demand signal today is a waitlist that asks one question — "what worries you most about your on-chain treasury" — and the answers are our interview script, not a guess. Next is 10–15 structured interviews with owners who hold or are considering a stablecoin treasury, to test whether the pain is felt as a priority and what it is worth.
>
> Distribution follows the threat, not the chain. The buyer is an owner, not a security team, so the channel is where owners already read about being targeted: stablecoin payroll and payments tooling, accounting and OTC desks serving crypto-paid businesses, and the Tempo builder community itself — every team shipping TIP-20 payments has a treasury to watch and is a referral path, not a competitor.
>
> Proposed pricing is monthly per monitored address: email free, phone calls from $49, multi-recipient escalation from $199. No customer has named a number yet — that is what the interviews are for. Fixed cost is ~$10–11/month and marginal cost per customer is cents, so the constraint is demand, not unit economics.

## Campo: o que existia antes de 14/09

> Nothing. The repository's first commit is 2026-10-02 and every commit is from October 2026, inside the competition window — `git log --reverse` confirms it, and `git log --until=2026-09-14` returns empty.
>
> Third-party open source composed with (not written by us, and not claimed as ours): Viem and `ox/tempo` for Tempo RPC and TIP-403 event decoding, Twilio's SDK for voice, `web-push` for RFC 8291 payload encryption, and Node/TypeScript tooling. Everything in `src/` — detection engine, privacy layer, delivery layer, dashboard — was written during the hackathon.

## Campo: blockchains e ferramentas

```
Tempo (TIP-20, TIP-403 / ReceivePolicyGuard) · Viem · ox/tempo · Twilio Programmable Voice · Web Push (RFC 8291 / VAPID) · Node.js + TypeScript · PostgreSQL · Railway
```

## Campo: credenciais de demonstração

> **Importante:** foram removidas do README de propósito (um segredo TOTP público contradiz o próprio `SECURITY.md`). É **aqui** que o jurado vai procurar — não esqueça de preencher.

```
URL:      https://viligion.com
Usuário:  henri
Senha:    <a senha que você definiu no reset>
TOTP:     <o segredo que você definiu no reset>
Rede:     Tempo Moderato (testnet) — sem fundos reais
```

---

## Roteiro do vídeo de demo (≤3 min)

A abertura é o ativo. Não narre nada nos primeiros 20 segundos.

| Tempo | O quê |
|---|---|
| 0:00–0:20 | Painel parado, silêncio. **A notificação chega no celular, com a marca.** Você não falou nada ainda. |
| 0:20–0:35 | *"Esse alerta chegou sem existir um número de telefone. Não tem operadora, não tem registro de ligação, não tem nada que ligue esse aparelho a essa tesouraria — nem para mim."* |
| 0:35–1:00 | `/alerts/preview`: o conteúdo de cada canal, sem disparar nada. Mostre que **nenhuma mensagem tem saldo, valor ou endereço.** |
| 1:00–1:40 | O que causou: `npx tsx scripts/verify-testnet.ts` — `TransferBlocked` real, decodificado da testnet Moderato. |
| 1:40–2:20 | Painel: faixa "Monitorando · último ciclo há Xs" com o contador subindo. Histórico → **"Não reconheço"**. *"Essa resposta é o sinal que o produto existe para capturar."* |
| 2:20–2:45 | `npx vitest run`: **378 testes**. Repo MIT público. |
| 2:45–3:00 | O que falta e quando: KMS gerenciado antes de qualquer cliente real. |

### Vídeo de apresentação (2–3 min)

Inverta a ordem natural: comece pela engenharia, não pela estatística.

> *"Construí uma coisa que liga pro meu telefone quando minha tesouraria se move. O maior problema de engenharia não foi fazer a ligação — foi garantir que a ligação não possa ser usada contra mim."*

Só então os números de wrench attack. Founder solo: primeira pessoa, sem desculpa pelo tamanho do time.

### NÃO mostrar

- **E-mail funcionando** — SMTP não está configurado, só loga
- **WhatsApp entregando o PIN** — falta o template aprovado (`TWILIO_WHATSAPP_CONTENT_SID`)
- **KMS gerenciado, número virtual dedicado, detecção de padrões de transferência** — os três proibidos pelo `SECURITY.md`; os três derrubam a credibilidade se o jurado abrir o código
- **A frase final da ligação em vídeo em inglês** — ela é `pt-BR` hardcoded ([webhook-server.ts:147](../src/webhook-server.ts#L147)). Grave com `ALERT_LOCALE=pt` ou não narre essa parte
- **A raiz do repo em tela** sem conferir antes

---

## Respostas prontas para as perguntas difíceis

**"A ligação já tocou?"** — Sim, e o canal sem telefone também: alerta de teste entregue num aparelho real em 12/10. O que falhou antes foi uma conta Twilio em trial sem número verificado, e isso está documentado no commit que corrigiu a detecção silenciosa da falha.

**"Cite um cliente do seu segmento."** — Não consigo: zero pagantes. A chain tem 7 meses e é enterprise-led; o segmento está se formando, não formado. O motor é núcleo + adaptador e já é agnóstico de chain, então o recorte não é "PME da Tempo", é "quem autocustodia stablecoin sem time de segurança". **Não invente cliente.**

**"O que impede a Cryptocurrency Alerting de adicionar Tempo?"** — Nada, e não vou alegar que integração de chain é moat. O difícil de copiar é o threat model como restrição de produto: conteúdo sempre genérico garantido por teste, prova EIP-191 no cadastro, destinatário sob AES-256-GCM separado do endereço, e um canal crítico que não usa número nenhum.

**"Por que isso é empresa e não projeto de fim de semana?"** — Hoje não é empresa. É um sistema funcionando com 378 testes, validado contra a rede real, com uma lista explícita do que falta — KMS gerenciado, recuperação de conta, cobrança — cada item travado por gatilho, não por data.

**"Vocês não cobrem o que a Chainalysis cobre na Tempo?"** — Correto, e eles **são** parceiros oficiais do ecossistema Tempo. Nosso recorte não é cobertura de chain, é segmento e modelo de ameaça: dono sem time de segurança.

---

## Checklist final

- [ ] Gravar vídeo de apresentação (2–3 min)
- [ ] Gravar vídeo de demo (≤3 min)
- [ ] Criar a submissão no portal da Colosseum
- [ ] Colar os textos acima, **reescritos na sua voz**
- [ ] **Preencher as credenciais de demo no formulário** (saíram do README)
- [ ] Confirmar que todo o time se inscreveu em colosseum.com
