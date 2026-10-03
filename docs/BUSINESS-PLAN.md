# Plano de Negócio e Desenvolvimento — VILIGION

> Documento de planejamento interno. Escrito para orientar decisão e execução, não é texto de submissão da Colosseum — a submissão é escrita pelo time, com voz própria. Última revisão: 2026-10-03.

## 0. Onde estamos de fato (sem otimismo nem pessimismo)

- **Produto**: núcleo técnico completo e testado (63 testes, CI verde) — motor de detecção, decodificação TIP-403/`ReceivePolicyGuard` via `ox/tempo`, privacidade (criptografia, prova de propriedade, PIN de uso único), painel (API) com MFA.
- **Alerta por severidade**: crítico vai por ligação (Twilio), normal vai por e-mail (SMTP) — ambos os canais opcionais em runtime, Twilio pode ficar configurado só mais perto da demo.
- **Validado contra a rede real** (não só simulação): RPC, endereço do `ReceivePolicyGuard` e decode de `TransferBlocked` confirmados contra a testnet Moderato com eventos reais (`scripts/verify-testnet.ts`). Um bug real de leitura de saldo (nativo vs. TIP-20) foi encontrado e corrigido nesse processo.
- **Open-source**: repositório público, MIT, CI, CODEOWNERS, templates de issue, histórico de commits limpo (sem segredo vazado).
- **Equipe**: founder solo. Sem cofounder, sem colaboradores externos no momento.
- **Maior risco em aberto agora**: fluxo de ponta a ponta com Twilio de verdade ainda não testado (falta conta Twilio configurada); vídeos não gravados; submissão ainda não criada no portal.
- **Pitch**: já corrigido de uma claim de "ineditismo" que não se sustentava (ver histórico desta investigação) — posicionamento agora é honesto sobre concorrência (Hexagate, Elliptic, TRM, Cryptocurrency Alerting).
- **Mercado**: a chain Tempo tem ~7 meses de existência (mainnet 18/03/2026). Não validamos ainda quantos negócios reais mantêm tesouraria TIP-20 nela hoje.
- **Roadmap registrado, não construído ainda**: canal de push via PWA e nudge (som/vibração distintos por tipo de alerta) — ver `ARCHITECTURE.md`. Avaliado e adiado conscientemente pra depois do prazo de submissão.

## 1. Modelo de negócio

### 1.1 Problema (validado com dados, não suposição)
Ataques físicos ligados à posse de cripto ("wrench attacks") cresceram em 2026: Chainalysis registra mais de US$30M roubados no H1; CertiK, com metodologia mais ampla, chega a US$124M em exposição, com invasão domiciliar ultrapassando sequestro como método mais comum. Donos de tesouraria on-chain sem time de segurança dedicado não têm hoje uma forma de monitorar risco sem expor o próprio canal de alerta a risco de coação.

### 1.2 Concorrência e posicionamento honesto
| Concorrente | Quem atende | O que falta pra cobrir nosso recorte |
|---|---|---|
| Hexagate (Chainalysis), Elliptic, TRM Labs, Blockaid | Times de segurança institucionais, ACV tipicamente > US$50k | Não serve PME sem time de segurança |
| Cryptocurrency Alerting | Indivíduos e negócios, US$4–49/mês, alerta por ligação em 8 chains | Não suporta Tempo; sem desenho de privacidade contra coação (número virtual, conteúdo genérico, prova de propriedade) |
| **VILIGION** | PME com tesouraria TIP-20 na Tempo, sem time de segurança | — |

Diferencial real: **privacidade desenhada contra o modelo de ameaça de coação física**, não o canal de ligação em si (isso já existe no mercado). Reforçado pela especificidade técnica na Tempo.

### 1.3 Monetização
Três modelos compatíveis entre si, em ordem de prioridade de implementação:

1. **SaaS por endereço monitorado** — preço mensal por tesouraria vigiada. Modelo principal.
2. **Freemium → upsell de canal de alerta** — alerta por e-mail grátis; ligação telefônica e múltiplos destinatários (a parte que tem custo real e é o diferencial) no plano pago.
3. **Cobrança on-chain via TIP-20** (diferenciador de pitch, não essencial no dia 1) — usando o Machine Payments Protocol nativo da Tempo para cobrar a assinatura diretamente da tesouraria monitorada.

### 1.4 Estrutura de custo (validada com preços reais de mercado)
| Item | Custo |
|---|---|
| Hospedagem (processo persistente) | ~US$5/mês |
| Número Twilio Voice (BR) | ~US$4,25/mês |
| AWS KMS | ~US$1–2/mês |
| RPC Tempo/Base | Gratuito (endpoint oficial) |
| **Fixo total** | **~US$10–11/mês**, independente do número de clientes |
| Marginal por cliente (ligações de alerta) | Centavos a poucos dólares/mês mesmo em uso pesado |

Unit economics favorável: custo marginal desprezível, custo fixo baixo — qualquer preço competitivo com o mercado de PME já dá margem alta. O fator limitante do negócio é **demanda**, não custo.

## 2. Plano de desenvolvimento, por fase

### Fase 0 — Hackathon (agora → 12/10/2026 23:59 PT)
Objetivo único: submissão completa e defensável. Nesta ordem de prioridade:

1. **Testar contra a rede real da Tempo** (testnet Moderato no mínimo) — maior risco de execução aberto. Sem isso, o critério "Functionality" fica vulnerável.
2. **Gravar os dois vídeos obrigatórios** (apresentação 2–3min, demo de produto até 3min).
3. **Criar a submissão no portal da Colosseum** — ainda não existe (confirmado via API: `projects: []` no perfil).
4. **Corrigir o deck de pitch** (`docs/VILIGION-apresentacao-time.pdf`) — remover a claim de decodificador inédito, substituir pela posição correta (compõe com `ox/tempo`, peça oficial do ecossistema).
5. Stretch goal, só se sobrar tempo: replicar o motor pra uma 2ª chain EVM (Base/Arbitrum) pra reforçar estratégia multi-track.

### Fase 1 — Validação pós-hackathon (outubro–dezembro 2026)
Independente do resultado do hackathon, isto é o que separa "projeto de hackathon" de "empresa":

- **Entrevistas com 10–15 donos de PME** que já têm ou cogitam tesouraria em stablecoin (não precisa ser especificamente na Tempo ainda) — validar se a dor é sentida como prioridade e quanto pagariam.
- **Resposta concreta pra "quantas PMEs têm tesouraria TIP-20 na Tempo hoje"** — hoje é a maior lacuna do pitch de mercado.
- **Beta fechado com 3–5 usuários reais** monitorando endereço de produção (não só testnet).
- **Formalização da empresa** — a Colosseum tem parceria com a Stablecorp (desconto de 30% em incorporação, banking em USDC) especificamente para times saindo de hackathon; vale usar em vez de resolver isso do zero.

### Fase 2 — Crescimento (2027, condicional à validação da Fase 1)
- Expandir cobertura multi-chain EVM (Base, Arbitrum, Ethereum L1) reusando o mesmo motor genérico.
- Avaliar aplicação ao Colosseum Accelerator (parte do mesmo programa do hackathon, com fundo de US$2,5M associado ao ciclo).
- Primeira contratação, se tração justificar — ver seção 3.

## 3. Estrutura necessária pra continuar (realista pra founder solo)

Uma empresa grande teria times dedicados de compliance, jurídico, vendas e segurança. Isso não existe aqui, e simular que existe seria pior que admitir o estágio real. Equivalentes enxutos, nesta ordem de necessidade:

| Função "big tech" | Equivalente realista agora |
|---|---|
| Jurídico/compliance | Stablecorp (parceria já confirmada no hub da Colosseum) pra formação de empresa e banking — não resolve questões regulatórias específicas de cada mercado onde vender, mas resolve o básico de existir como empresa |
| Segurança/auditoria | Os 36+ testes automatizados e o `SECURITY.md` já documentado são a base; uma auditoria externa de verdade (não um teste de cliente/binário compilado) só faz sentido com tração real, é caro demais pro estágio atual |
| Vendas/GTM | Founder solo faz as primeiras 10–15 entrevistas de validação pessoalmente — não terceirizar isso, é a parte que mais ensina |
| Engenharia adicional | Não contratar ainda; o gargalo agora é validação de mercado, não capacidade técnica |

**Quando buscar cofounder ou primeira contratação**: depois da Fase 1, se a validação confirmar demanda real — e preferencialmente alguém que cubra uma lacuna hoje inexistente (GTM/vendas, já que a parte técnica está coberta).

## 4. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Tempo ainda tem poucas PMEs com tesouraria real | Alto — mercado pequeno hoje | Validar na Fase 1 antes de qualquer investimento maior; multi-chain reduz dependência de uma única chain |
| Núcleo nunca testado em rede real até o deadline | Alto — critério "Functionality" | Prioridade #1 desta semana, antes de qualquer polimento de pitch |
| Founder solo sem backup técnico ou comercial | Médio | Documentação extensa já reduz risco de "bus factor"; buscar cofounder só depois de validação, não antes |
| Dependência de Twilio como canal único de alerta | Médio | Já mitigado por desenho — múltiplos destinatários; redundância de canal (PWA push) é roadmap pós-hackathon, não prioridade agora |

## 5. Métricas de sucesso por fase

- **Fase 0**: submissão completa e no ar antes do deadline; demo rodando contra rede real, não só simulação.
- **Fase 1**: número de entrevistas concluídas; resposta validada (não estimada) pro tamanho do mercado endereçável na Tempo; 1+ usuário real em produção.
- **Fase 2**: primeiro cliente pagante; margem unitária confirmada na prática, não só projetada.

## 6. Checklist imediato (próximos dias até 12/10)

- [ ] Testar o monitor contra a testnet Moderato da Tempo com endereço real
- [ ] Gravar vídeo de apresentação (2–3min)
- [ ] Gravar vídeo de demo do produto (até 3min)
- [ ] Criar a submissão no portal da Colosseum
- [ ] Corrigir `docs/VILIGION-apresentacao-time.pdf` (remover claim de ineditismo do decodificador)
- [ ] Preencher campos obrigatórios do portal: GitHub (já público), equipe, localização, go-to-market
