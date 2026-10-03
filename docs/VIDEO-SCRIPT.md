# Roteiro dos vídeos de submissão

> Rascunho de apoio pra gravação — adapte pras suas próprias palavras na hora de gravar. Um roteiro lido palavra por palavra soa robótico; use isto como estrutura e pontos que não podem faltar, não como teleprompter.

Exigências oficiais ([h-faq-11](https://colosseum.com/hackathon#h-faq-11)): vídeo de apresentação de 2–3 minutos + vídeo de demo de produto de até 3 minutos. São dois arquivos separados.

## O que dá pra gravar hoje, sem esperar Twilio

O painel (`dashboard/server.ts`) hoje é só API JSON, sem tela — e a ligação ainda não está configurada (decisão consciente, ver `BUSINESS-PLAN.md`). A demo real e honesta agora é: **terminal rodando o monitor contra a rede real da Tempo**, mostrando detecção acontecendo ao vivo. Isso é mais forte do que parece pro critério "Functionality" — jurista técnico valoriza ver código funcionando contra chain de verdade mais do que uma UI polida de mentira.

Dica pra deixar a demo visualmente impressionante: aponte `DEMO_WATCHED_ADDRESS` pro endereço que já confirmamos ter `TransferBlocked` real na testnet Moderato (`0x384314C543c3CBE50D3F148F7da97d5F8be928Ec`, bloco 37914998, achado via `scripts/verify-testnet.ts`) — o evento decodifica ao vivo na tela, não é mockado.

---

## Vídeo 1 — Apresentação (2–3 min)

Este é o que os jurados veem primeiro. Foco: founder-market fit, insight, posicionamento honesto.

**[0:00–0:25] O problema, com dado real**
- Wrench attacks cresceram em 2026 — cite os números que já validamos (Chainalysis: +US$30M no H1; CertiK: até US$124M em exposição, invasão domiciliar ultrapassando sequestro).
- Quem sofre: dono de PME com tesouraria em stablecoin, sem time de segurança — tem que ficar olhando dashboard o dia inteiro, ou arrisca vincular o próprio telefone ao saldo.

**[0:25–0:55] Por que as soluções existentes não resolvem — nomeie os concorrentes**
- Hexagate, Elliptic, TRM Labs: institucional, ACV tipicamente > US$50k. Não é pra PME.
- Cryptocurrency Alerting: já faz alerta por ligação, US$4–49/mês — mas não suporta Tempo, e não foi desenhado contra o risco de coação física (sem número virtual, sem conteúdo genérico, sem prova de propriedade).
- **Diga isso explicitamente no vídeo.** Reconhecer concorrente de cabeça erguida pontua mais em "Insight" do que fingir que ninguém mais existe — e evita um jurado técnico derrubar a claim na primeira pergunta.

**[0:55–1:30] O que o VILIGION faz diferente**
- Monitora tesouraria TIP-20 na Tempo, detecta anomalia (queda de saldo real via `balanceOf`, e transferência bloqueada via `ReceivePolicyGuard`/TIP-403).
- Alerta por severidade: crítico vai por ligação telefônica (quando configurada), normal vai por e-mail — decisão de produto, não limitação técnica (explique o porquê: nem toda anomalia justifica o custo e a exposição de uma ligação).
- Privacidade desde a concepção: conteúdo do alerta nunca revela saldo/endereço, número virtual dedicado, prova de propriedade por assinatura, PIN de uso único.

**[1:30–2:00] Plano de negócio, resumido**
- Modelo: SaaS por endereço monitorado + freemium (e-mail grátis, ligação paga).
- Unit economics: custo fixo ~US$10-11/mês, marginal por cliente é centavos — mencione que isso já foi validado com números reais de mercado, não estimativa solta.
- Honestidade sobre o mercado: Tempo tem ~7 meses de existência: a aposta é ser infraestrutura de segurança nativa desde o início de um ecossistema que ainda está validando adoção.

**[2:00–2:30, se sobrar tempo] Quem está construindo**
- Founder solo — diga isso sem rodeio. Histórico da Colosseum mostra que tamanho de time não prediz vitória (times de 1 a 5 pessoas já venceram).

---

## Vídeo 2 — Demo do produto (até 3 min)

Foco: provar que funciona contra dado real, não simulação.

**[0:00–0:20] Contexto rápido**
- "Isto é o VILIGION rodando contra a testnet Moderato da Tempo, rede real, não simulação."

**[0:20–1:00] Suba o monitor ao vivo**
- Terminal: `npm run dev` (com `.env` configurado: `TEMPO_RPC_URL`, `TEMPO_CHAIN_ID`, `DEMO_WATCHED_ADDRESS` apontando pro endereço com `TransferBlocked` real).
- Mostre o log de startup: RPC conectado, canais de alerta (crítico/normal) reportando se estão ativos ou não configurados ainda.

**[1:00–2:00] Mostre a detecção acontecendo**
- Rode (ou já tenha rodado e mostre o output de) `npx tsx scripts/verify-testnet.ts` como prova adicional, lado a lado: endereço do `ReceivePolicyGuard` batendo com o oficial, bytecode confirmado, e principalmente — o evento `TransferBlocked` real decodificado na tela, com `blockedReason`, `kind`, `memo`, tudo via `ox/tempo`.
- Narre o que a tela mostra: "isso não é dado inventado, é uma transferência real bloqueada por política de recebimento, decodificada ao vivo."

**[2:00–2:40] Mostre o roteamento por severidade**
- No log do `dispatchAlert`, aponte a linha mostrando severidade (`normal` ou `critical`) e qual canal seria usado.
- Se o SMTP estiver configurado: mostre o e-mail chegando de verdade na caixa de entrada — conteúdo genérico, sem saldo/endereço.
- Se Twilio não estiver configurado ainda: tudo bem narrar isso com transparência — "ligação é reservada pra severidade crítica; aqui está configurada como próximo passo, o sistema já loga que faria a chamada."

**[2:40–3:00] Fechamento**
- "Core testado — 63 testes automatizados, CI rodando a cada commit, repositório público." (Mostrar rapidamente o badge do GitHub Actions ou o terminal do `npx vitest run` passando é mais forte que só falar.)

---

## Checklist antes de gravar

- [ ] `.env` preenchido com `TEMPO_RPC_URL`/`TEMPO_CHAIN_ID` reais (ver `.env.example`, valores confirmados em `scripts/verify-testnet.ts`)
- [ ] `DEMO_WATCHED_ADDRESS` apontando pro endereço com evento real já confirmado
- [ ] Rodar `npx tsx scripts/verify-testnet.ts` uma vez antes de gravar, pra garantir que ainda há eventos recentes na janela de 10.000 blocos (se não houver, aumente a janela no script ou rode de novo mais perto da gravação)
- [ ] Decidir: grava com SMTP configurado (e-mail real chegando) ou só com o log explicando o canal
