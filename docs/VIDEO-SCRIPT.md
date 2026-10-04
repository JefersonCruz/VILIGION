# Roteiro dos vídeos de submissão

> Rascunho de apoio pra gravação — adapte pras suas próprias palavras na hora de gravar. Um roteiro lido palavra por palavra soa robótico; use isto como estrutura e pontos que não podem faltar, não como teleprompter.

Exigências oficiais ([h-faq-11](https://colosseum.com/hackathon#h-faq-11)): vídeo de apresentação de 2–3 minutos + vídeo de demo de produto de até 3 minutos. São dois arquivos separados.

## O que dá pra gravar hoje (atualizado 2026-10-04 — portal completo, canal crítico de verdade)

Desde a última revisão deste roteiro (03/10), o produto avançou bastante:

- **Destinatários de alerta** (`/recipients`): o próprio usuário cadastra telefone/e-mail pelo painel, criptografados — não depende mais de variável de ambiente compartilhada.
- **QR code de TOTP**: a tela de cadastro concluído mostra um QR escaneável, não só um texto longo pra copiar.
- **Registro dinâmico de monitor**: adicionar uma conta em `/accounts` sobe o monitoramento na hora, sem precisar reiniciar nada — dá pra mostrar isso ao vivo (cadastra → já está monitorando).
- **Tutorial inline**: `/signup`, `/accounts`, `/thresholds` e `/recipients` agora explicam o que cada campo faz antes de preencher.
- **Canal crítico com entrega real do PIN**: a ligação toca e o código de confirmação chega por WhatsApp de verdade (antes, o script da ligação prometia isso mas nada enviava) — **só mostre isso no vídeo depois de validar com uma conta Twilio real configurada** (ver checklist no fim deste arquivo).
- **139 testes automatizados**, CI verde.

⚠️ **Antes de gravar**: o deploy do Railway está atrasado em relação a tudo isso. Redeploy + nova migration primeiro (ver `docs/DEPLOYMENT.md`), senão a demo ao vivo mostra a versão antiga.

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
- Monitora tesouraria TIP-20 na Tempo, detecta anomalia (queda de saldo real via `balanceOf` — já filtrando taxa de transação, que na Tempo sai do próprio token monitorado — e transferência bloqueada via `ReceivePolicyGuard`/TIP-403).
- Alerta por severidade: crítico vai por ligação telefônica + WhatsApp com o código de confirmação, normal vai por e-mail — decisão de produto, não limitação técnica (explique o porquê: nem toda anomalia justifica o custo e a exposição de uma ligação).
- Privacidade desde a concepção: conteúdo do alerta nunca revela saldo/endereço, destinatários de alerta criptografados (o próprio usuário cadastra pelo painel), prova de propriedade por assinatura, PIN de uso único com limite de tentativas.

**[1:30–2:00] Plano de negócio, resumido**
- Modelo: SaaS mensal por endereço monitorado + freemium (e-mail grátis, ligação paga) — sem compromisso anual por enquanto, dado o estágio de validação.
- Unit economics: custo fixo ~US$10-11/mês, marginal por cliente é centavos — mencione que isso já foi validado com números reais de mercado, não estimativa solta.
- Honestidade sobre o mercado: Tempo tem ~7 meses de existência: a aposta é ser infraestrutura de segurança nativa desde o início de um ecossistema que ainda está validando adoção.

**[2:00–2:30, se sobrar tempo] Quem está construindo**
- Founder solo — diga isso sem rodeio. Histórico da Colosseum mostra que tamanho de time não prediz vitória (times de 1 a 5 pessoas já venceram).

---

## Vídeo 2 — Demo do produto (até 3 min)

Foco: provar que funciona contra dado real, não simulação — e agora dá pra mostrar o produto inteiro, não só o motor.

**[0:00–0:15] Contexto rápido**
- "Isto é o VILIGION rodando contra a testnet Moderato da Tempo, rede real, não simulação."

**[0:15–0:40] Cadastro de verdade**
- Abra `/signup` — mostre o tutorial de 3 passos na tela, conecte uma carteira (MetaMask/outra), assine a prova de propriedade ao vivo.
- Na tela de sucesso, mostre o **QR code** do TOTP sendo escaneado pelo autenticador do celular — mais visual que digitar um código manualmente.

**[0:40–1:10] Configure o monitoramento ao vivo**
- Logado, vá em `/accounts` e adicione uma conta — narre: "o monitor começa a rodar agora, na hora, sem precisar reiniciar nada" (diferencial real: antes isso exigia redeploy manual).
- Em `/recipients`, cadastre um telefone e um e-mail — narre que ficam criptografados, não em texto puro.

**[1:10–1:45] Mostre a detecção acontecendo**
- Rode (ou já tenha rodado e mostre o output de) `npx tsx scripts/verify-testnet.ts` como prova adicional: endereço do `ReceivePolicyGuard` batendo com o oficial, bytecode confirmado, e o evento `TransferBlocked` real decodificado na tela, com `blockedReason`, `kind`, `memo`, tudo via `ox/tempo`.
- Narre: "isso não é dado inventado, é uma transferência real bloqueada por política de recebimento, decodificada ao vivo."

**[1:45–2:30] Mostre o canal crítico de verdade (só se já validado — ver checklist)**
- Force (ou aguarde) um alerta crítico disparar. Mostre a ligação tocando e o WhatsApp chegando com o código de confirmação. Digite o código na ligação, confirme.
- Se o canal crítico ainda não estiver validado com conta Twilio real na hora da gravação: narre com transparência — "ligação é reservada pra severidade crítica; aqui o sistema já loga que faria a chamada e enviaria o código por WhatsApp" — e mostre o log do `dispatchAlert` com a severidade e o canal escolhido.

**[2:30–2:50] Fechamento**
- "Core testado — 139 testes automatizados, CI rodando a cada commit, repositório público." (Mostrar rapidamente o terminal do `npx vitest run` passando é mais forte que só falar.)

---

## Checklist antes de gravar

- [ ] Redeploy no Railway com o código mais recente + nova migration (schema de destinatários mudou) — ver `docs/DEPLOYMENT.md`
- [ ] `.env`/variáveis do Railway preenchidas com `TEMPO_RPC_URL`/`TEMPO_CHAIN_ID` reais (ver `.env.example`, valores confirmados em `scripts/verify-testnet.ts`)
- [ ] `DEMO_WATCHED_ADDRESS` apontando pro endereço com evento real já confirmado
- [ ] Rodar `npx tsx scripts/verify-testnet.ts` uma vez antes de gravar, pra garantir que ainda há eventos recentes na janela de 10.000 blocos (se não houver, aumente a janela no script ou rode de novo mais perto da gravação)
- [ ] Conta Twilio real configurada (voz + WhatsApp, sandbox já serve) e **testada com um alerta real disparado** antes de decidir se o vídeo mostra o canal crítico ao vivo ou só narrado
- [ ] Decidir: grava com SMTP configurado (e-mail real chegando) ou só com o log explicando o canal
