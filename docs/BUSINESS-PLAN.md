# Plano de Negócio e Desenvolvimento — VILIGION

> Documento de planejamento interno. Escrito para orientar decisão e execução, não é texto de submissão da Colosseum — a submissão é escrita pelo time, com voz própria. Última revisão: 2026-10-04. Para viabilidade técnica/esforço de cada melhoria de produto específica (não mercado/monetização, que ficam aqui), ver [`docs/PRODUCT-FEASIBILITY.md`](./PRODUCT-FEASIBILITY.md).

## 0. Onde estamos de fato (sem otimismo nem pessimismo)

- **Produto**: núcleo técnico completo e testado (**176 testes**, CI verde) — motor de detecção, decodificação TIP-403/`ReceivePolicyGuard` via `ox/tempo`, classificação fee-vs-valor-real (`getFeeAdjustment`, fecha o risco de falso-positivo por taxa), privacidade (criptografia envelope AES-256-GCM, prova de propriedade, PIN de uso único com limite de tentativas).
- **Portal completo construído e validado de ponta a ponta**, agora com **registro dinâmico de monitor** (2026-10-04): cadastrar uma conta em `/accounts` sobe o monitoramento na hora, sem precisar reiniciar o deploy — fechou um gap sério que fazia usuário novo nunca ser monitorado de verdade. Telas: cadastro (assinatura real, EIP-191, com QR code de TOTP e tutorial inline), login com MFA, painel, contas monitoradas, limiares, **destinatários de alerta** (`/recipients` — telefone/e-mail criptografados, cadastrados pelo próprio usuário, substituindo env var compartilhada), histórico de alertas. Todas as telas de configuração têm explicação inline agora, não só depois de um erro.
- **Alerta por severidade**: crítico vai por ligação **e WhatsApp com o PIN de confirmação** (Twilio), normal vai por e-mail (SMTP) — ambos os canais opcionais em runtime. **Corrigido 2026-10-04**: o PIN nunca tinha sido realmente entregue ao usuário (o script prometia WhatsApp, nenhum código enviava) — agora entrega de verdade, com fallback falado se WhatsApp não estiver configurado.
- **Validado contra a rede real** (não só simulação): RPC, endereço do `ReceivePolicyGuard` e decode de `TransferBlocked` confirmados contra a testnet Moderato com eventos reais (`scripts/verify-testnet.ts`). Um bug real de leitura de saldo (nativo vs. TIP-20) foi encontrado e corrigido nesse processo.
- **Open-source**: repositório público, MIT, CI, CODEOWNERS, templates de issue, histórico de commits limpo (sem segredo vazado). `TERMS-OF-USE.md` (rascunho, pendente de revisão jurídica real) adicionado.
- **Equipe**: founder solo. Sem cofounder, sem colaboradores externos no momento.
- **Maior risco em aberto agora**: fluxo de ponta a ponta com Twilio/WhatsApp de verdade ainda não testado com conta real configurada (a lógica está testada com fakes, não com uma ligação/WhatsApp de verdade chegando num telefone) — mais importante agora que antes, porque a funcionalidade real existe e precisa ser confirmada antes da gravação do vídeo de demo. Vídeos não gravados (`docs/VIDEO-SCRIPT.md` atualizado em 2026-10-04 pra refletir tudo isso); submissão ainda não criada no portal; deploy do Railway está **desatualizado** em relação a tudo isso (precisa de redeploy + nova migration antes de qualquer gravação).
- **Pitch**: já corrigido de uma claim de "ineditismo" que não se sustentava — `docs/VILIGION-apresentacao-time.pdf` já tem essa correção desde 2026-10-03, mas sua tabela de status (seção 4.6) ficou desatualizada frente a tudo construído depois; vale atualizar antes de usar o deck de novo.
- **Mercado**: a chain Tempo tem ~7 meses de existência (mainnet 18/03/2026). Não validamos ainda quantos negócios reais mantêm tesouraria TIP-20 nela hoje.
- **Cobrança**: modelo decidido (mensal, sem anual por enquanto; TIP-20 nativo, não "qualquer cripto" — ver seção 1.3), mas **nenhum código de cobrança implementado de propósito** — depende da empresa estar formalizada primeiro (seção 3).
- **Roadmap registrado, não construído ainda**: canal de push via PWA e nudge (som/vibração distintos por tipo de alerta), botão de "testar alerta", recuperação de conta (senha/TOTP perdidos), página pública explicativa antes do `/signup`, KMS de produção (hoje `LocalDevKeyProvider`, documentado como dev-only) — ver `ARCHITECTURE.md`. Avaliados e adiados conscientemente pra depois do prazo de submissão.

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
3. **Cobrança on-chain via TIP-20** (diferenciador de pitch, não essencial no dia 1) — usando o Machine Payments Protocol nativo da Tempo para cobrar a assinatura diretamente da tesouraria monitorada. Escopo deliberado: **só a stablecoin TIP-20 nativa da Tempo, não "qualquer cripto"** — o cliente já segura esse token (é o que o produto monitora), então cobrar nele é fricção zero e reforça a especificidade técnica na Tempo. Aceitar múltiplas criptos exigiria gateway de pagamento de terceiro (custo por transação, mais uma dependência externa) e um tesouro próprio em ativos variados pra gerenciar/converter — resolve um problema que este cliente específico não tem, mesmo padrão de risco já descartado pra "monitorar qualquer carteira/chain/exchange" (ver seção 1.2 e `ARCHITECTURE.md`).

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

1. ~~Testar contra a rede real da Tempo~~ — **feito** (`scripts/verify-testnet.ts`), confirmado contra testnet Moderato com eventos reais; achou e corrigiu um bug real de leitura de saldo no processo.
2. **Gravar os dois vídeos obrigatórios** (apresentação 2–3min, demo de produto até 3min) — roteiro pronto em `docs/VIDEO-SCRIPT.md`.
3. **Criar a submissão no portal da Colosseum** — ainda não existe (confirmado via API: `projects: []` no perfil). Só o dono da conta consegue fazer isso.
4. **Corrigir o deck de pitch** (`docs/VILIGION-apresentacao-time.pdf`) — remover a claim de decodificador inédito, substituir pela posição correta (compõe com `ox/tempo`, peça oficial do ecossistema). Ainda pendente — é PDF, não editável por aqui.
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
| Jurídico/compliance | Stablecorp (parceria já confirmada no hub da Colosseum) pra formação de empresa e banking — não resolve questões regulatórias específicas de cada mercado onde vender, mas resolve o básico de existir como empresa. Minuta inicial de Termos de Uso em [`TERMS-OF-USE.md`](../TERMS-OF-USE.md) (2026-10-03) — rascunho pra acelerar a revisão jurídica real, não substitui ela; itens entre `[placeholder]` (entidade legal, jurisdição, limitação de responsabilidade) dependem da formalização acima |
| Segurança/auditoria | Os 36+ testes automatizados e o `SECURITY.md` já documentado são a base; uma auditoria externa de verdade (não um teste de cliente/binário compilado) só faz sentido com tração real, é caro demais pro estágio atual |
| Vendas/GTM | Founder solo faz as primeiras 10–15 entrevistas de validação pessoalmente — não terceirizar isso, é a parte que mais ensina |
| Agente de P&D (ver `GOVERNANCE.md`) | Não contratar ainda — founder solo absorve isso por enquanto, mas o papel está definido: manter as premissas sobre a Tempo em dia (RPC, ABI, endereços), re-verificando periodicamente contra doc oficial e rede real |
| Cientista de Dados (ver `GOVERNANCE.md`) | Não contratar ainda — mas é o dono natural da lacuna real já identificada (`classifyBalanceDelta` nunca filtra fee de valor real). Primeiro gatilho pra trazer alguém: quando houver dado real de uso (não só testnet) pra calibrar isso de verdade |

**Quando buscar cofounder ou primeira contratação**: depois da Fase 1, se a validação confirmar demanda real. Prioridade de contratação, nessa ordem: (1) GTM/vendas — hoje é a lacuna mais crítica; (2) Cientista de Dados — só faz sentido com volume real de transações pra calibrar; (3) Agente de P&D — papel que o founder consegue sustentar sozinho por mais tempo, já que é o mesmo tipo de trabalho feito nesta própria investigação.

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

## 6. Plano real até 12/10 (reescrito 2026-10-04, 8 dias restantes)

Ordenado por prioridade real, não por ordem de lembrança. Cada bloco trava o próximo — não vale pular pra gravação sem fechar o bloco 1 antes, senão o vídeo mostra uma versão desatualizada ou com canal de alerta não comprovado.

**Bloco 1 — Colocar o que foi construído pra rodar de verdade (1-2 dias)**
- [ ] Redeploy no Railway com todo o código de 2026-10-04 (criptografia de destinatários, WhatsApp, registro dinâmico de monitor, etc.) — o deploy atual é de antes dessas mudanças.
- [ ] Rodar a migration de novo (`npm run migrate`) — schema de `alert_recipients` mudou (agora criptografado); sem dado real de cliente ainda, então é seguro recriar.
- [ ] Configurar uma conta Twilio real: número de voz + WhatsApp (o sandbox gratuito já serve pra validar, não precisa de número aprovado ainda).
- [ ] **Disparar um alerta crítico de verdade** (não teste automatizado) e confirmar: a ligação toca, o WhatsApp chega com o PIN, digitar o PIN na ligação confirma, o painel mostra o status certo. Isto é o maior risco em aberto do projeto agora — sem isso, ninguém sabe se o canal crítico funciona de ponta a ponta.

**Bloco 2 — Preparar os entregáveis de gravação (pode rodar em paralelo ao Bloco 1)**
- [x] ~~Corrigir `docs/VILIGION-apresentacao-time.pdf` (claim de ineditismo)~~ — já corrigido desde 2026-10-03, só estava desatualizado neste checklist.
- [ ] Atualizar a tabela de status (seção 4.6) do `docs/VILIGION-apresentacao-time.pdf` — ainda diz "painel só API, sem tela HTML" e "endpoints de cadastro não ligados", os dois já não são verdade. É PDF, precisa editar manualmente (posso redigir o texto atualizado pra você colar).
- [x] ~~Atualizar `docs/VIDEO-SCRIPT.md`~~ — reescrito em 2026-10-04 pra mostrar o portal completo (destinatários, QR code, registro dinâmico) em vez da versão de 03/10.

**Bloco 3 — Gravar (depois do Bloco 1 confirmado funcionando)**
- [ ] Gravar vídeo de apresentação (2–3min) — roteiro em `docs/VIDEO-SCRIPT.md`.
- [ ] Gravar vídeo de demo do produto (até 3min) — mesmo roteiro, agora mostrando o canal crítico funcionando de verdade, não só o log dizendo "faria a ligação".

**Bloco 4 — Submeter**
- [ ] Criar a submissão no portal da Colosseum — só o dono da conta consegue.
- [ ] Preencher campos obrigatórios: nome, descrição em inglês, trilha (Tempo), o que já existia antes de 14/09, GitHub (já público), equipe, localização, go-to-market.
- [ ] Confirmar que todo o time já se inscreveu em colosseum.com.

**Fora do escopo até 12/10, de propósito** (não vale começar antes da submissão): botão de testar alerta, recuperação de conta, página pública explicativa, KMS de produção, cobrança — todos já registrados como roadmap pós-hackathon na seção 0.
