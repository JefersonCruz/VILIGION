# Relatório de Viabilidade e Melhoria — VILIGION

> **Data:** 2026-10-11 · **Prazo de submissão:** 2026-10-12 23:59 PT (`submissionDeadline: 2026-10-13T06:59:00Z`) — ~1,5 dia.
> **Escrito para:** o founder, para decisão e execução hoje. Não é texto de submissão — a submissão é escrita na sua voz (ver §5).
> **Método:** quatro análises independentes (negócio, mercado, design de produto, marketing/relações exteriores), com os achados de fato verificados contra o repo, a produção na Railway, a rede Tempo e fontes públicas. Tudo que é estimativa está rotulado **[EST]**.

---

## §0. Correções de fato ao material existente (verificadas, aplicar antes de submeter)

Estes seis itens são erros factuais no material que um jurado lê. Não são opinião.

### 0.1 — A contagem de testes está errada em todo o material: são **235 testes em 33 arquivos**

`npm test` em 2026-10-11: `Test Files 33 passed (33) · Tests 235 passed (235)` — eram 202 em 30 arquivos antes do canal de push adicionado hoje (§4.7).
`BUSINESS-PLAN.md` §0 e §3, e todo texto derivado, dizem "187 testes em 29 arquivos" — número correto em 08/10, desatualizado desde então. Corrigir para 235/33.

### 0.2 — A ligação **já disparou** em produção. O que falhou foi a entrega, e a causa é externa

`BUSINESS-PLAN.md` §0 e §6 afirmam que nenhuma linha `[alerta] disparando` jamais apareceu nos logs. Isso não é mais verdade:

```
2026-10-10T00:03:03Z  [alerta] user=9fdddaf5-… balance-drop (severidade=critical, alertId=6037b0b5-…)
```

O formato corresponde ao dispatcher **Postgres** (`src/index.ts:406`), não ao modo demo — ou seja, caminho real multi-usuário, com busca de destinatário no banco.

**Causa raiz, documentada no próprio commit `d0575d1`:** conta **Twilio em trial, sem nenhum número verificado** (`outgoing_caller_ids` vazio, confirmado direto na API da Twilio). A ligação foi tentada e rejeitada. A falha era engolida em silêncio porque `placeAlertCall` usa `Promise.allSettled` e ninguém inspecionava o retorno — corrigido em `d0575d1` e implantado em produção **5 minutos depois** daquele alerta (deploy `c22cd5ae`, 00:08).

**Consequência prática — e é a melhor notícia deste relatório:** o bloqueador nº 1 do projeto **não é código**. É verificar o número de destino no console da Twilio (ou fazer upgrade para conta paga). Minutos de trabalho, e a partir daí qualquer falha nova aparece em log com o motivo real e grava `pin_status = 'delivery-failed'` no histórico.

### 0.3 — Dois itens do checklist §6 já estão fechados por evidência

- **Migration rodou e `alert_recipients` funciona com o schema criptografado.** Prova indireta mas sólida: aquele alerta leu um telefone cadastrado e chegou a chamar a Twilio. Se a tabela não existisse haveria erro de relação; se estivesse vazia, o log diria `nenhum telefone cadastrado, ligação não tem pra onde ir` (`src/index.ts:414`). Nenhuma das duas linhas aparece.
- **Produção está no commit mais recente de código.** Os dois commits posteriores ao deploy (`3e6f246`, `91bfde0`) alteram só `README.md`, `docs/BUSINESS-PLAN.md` e `docs/FASE1-INTERVIEW-SCRIPT.md`.

### 0.4 — 🔴 O eixo de diferenciação do pitch tem um furo factual

`BUSINESS-PLAN.md` §1.2 e a landing implicam que os players institucionais não cobrem a Tempo. **Eles cobrem.** A página oficial `tempo.xyz/ecosystem` lista, em segurança e compliance: **Blockaid, Chainalysis, Elliptic, Range, TRES e TRM Labs** — e, em custódia, **BitGo, Fireblocks, Turnkey**. Hexagate é da Chainalysis.

Se um jurado abrir aquela página, o argumento de cobertura cai. **O que sobra verdadeiro e suficiente na mesma linha é "não serve PME sem time de segurança".** Reescrever a coluna "o que falta pra cobrir nosso recorte" para falar só de **segmento, preço e modelo de ameaça** — nunca de cobertura de chain.

### 0.5 — O dado de 33% está citado de forma derrubável

São **33% mais incidentes** (52 no H1 2026 vs 39 no H1 2025, CertiK), não 33% de perdas — do lado financeiro o salto é de ~11,8x (US$10,5M → US$124,1M de *exposição registrada*). O README hoje diz "grew more than 33% year-over-year" sem a palavra "incidentes"; ao lado de US$124M, o leitor assume que o 33% é de perdas e o número parece errado por ordem de magnitude.

Três ajustes obrigatórios:
1. `"33% more recorded incidents year-over-year"` — a palavra *incidents* é o que salva a frase.
2. Ao citar CertiK (US$124M) e Chainalysis (>US$30M) juntos, dizer **"two different methodologies"**: exposição ≠ valor roubado. Lado a lado sem isso, parecem contraditórios.
3. Não dizer que o fenômeno está "explodindo" sem qualificar: pela métrica ampla da Chainalysis, 2026 (~US$107M) está **abaixo** de 2025 (US$180M) e 2024 (US$316M), e a taxa de sucesso do atacante caiu de 49% para 26%.

**E a fragilidade mais importante, que não é numérica:** 75–82% dos casos são na Europa (França concentra ~30 dos ~50), e as vítimas são **indivíduos em autocustódia / HNW**, não PME com tesouraria on-chain. **Não existe dado público** ligando wrench attacks a tesourarias de PME, nem ao Brasil. Posicione como **risco de desenho** ("o risco é documentado, então um canal de alerta não pode amplificá-lo"), não como **mercado medido**.

### 0.6 — Não citar OpenZeppelin Defender como concorrente ativo

Foi desligado em 01/07/2026. O que existe é o **OpenZeppelin Monitor** (open source, self-host, exige equipe técnica).

---

## §1. Caminho crítico até a submissão — ordenado pelo relógio

Cada bloco trava o próximo. Não pule para gravação sem o Bloco A verde.

### Bloco A — fazer a ligação tocar (~30 min) 🔴 **domina tudo**

1. **Console da Twilio:** verificar o número de destino, ou upgrade para conta paga. É a causa raiz do §0.2 e é ação externa — ninguém no código resolve.
2. **Apertar "Enviar alerta de teste"** em `/recipients`. Confirmar os quatro elos: o telefone toca · o PIN chega (falado serve) · digitar o PIN confirma · o painel mostra o status certo.
3. Se falhar, agora o log diz o motivo real — isso é novo desde `d0575d1`.

> A pergunta nº 2 de qualquer jurado é *"a ligação já tocou?"*. **Não existe boa resposta honesta para "não".** Enquanto o Bloco A não estiver verde, nenhum texto deste relatório importa.

### Bloco B — correções de fato no material público (~45 min, em paralelo)

4. README e landing: `235 testes` (§0.1) · `33% more recorded incidents` + `two methodologies` (§0.5).
5. `BUSINESS-PLAN.md` §1.2: reescrever o eixo de diferenciação (§0.4). Remover OpenZeppelin Defender (§0.6).
6. 🔴 **Tirar as credenciais demo do README** (§5.4). Substituir por: *"Live demo at viligion.com. Judges and reviewers: credentials on request."* e colocar as credenciais no campo da submissão, que é privado aos jurados. Preserva 100% do benefício, elimina o risco.
7. `BUSINESS-PLAN.md` §1.3: corrigir a contradição de cobrança (§2.1).

### Bloco C — correção de produto de 5 linhas (~10 min, opcional mas barata)

8. Limiares padrão de quem se cadastra (§4.1). Único item de código que vale tocar hoje; fora de cripto, auth e do canal de alerta.

### Bloco D — gravar (~2h)

9. Dois vídeos, com o cold open do §5.2. **Gravar com `ALERT_LOCALE=pt`** ou não narrar a frase final da ligação (§4.2, item 6 — bug de idioma visível na câmera).

### Bloco E — submeter (~1h)

10. Criar a submissão no portal, colar os textos do §5.1 **reescritos na sua voz**, conferir que todo o time se inscreveu em colosseum.com.

**Critérios de julgamento** (`colosseum.com/hackathon#h-faq-12`): Founder+Market Fit · Insight · Product+Execution · Potential Market Size · **Founder Communication** · Viability · Traction. Nenhum premia quantidade de features; **dois dos sete são sobre comunicação e insight** — é isso que define a prioridade do vídeo sobre qualquer código novo.

---

## §2. Viabilidade de negócio

### 2.1 🔴 A cobrança on-chain contradiz o próprio modelo de ameaça

`BUSINESS-PLAN.md` §1.3, modelo 3, propõe cobrar a assinatura **"diretamente da tesouraria monitorada"**. Isso pede allowance/pull permanente sobre exatamente o endereço que o produto promete proteger de dreno. O pitch inteiro é *"ninguém deveria conseguir sacar dessa tesouraria"* e a cobrança pede permissão de saque dela.

**Correção de 10 minutos:** invoice **push** (o cliente paga), ou allowance de um **endereço operacional separado** — nunca da tesouraria vigiada. É o maior impacto por minuto de todo este relatório.

### 2.2 A ordem de implementação dos modelos está invertida

- **Modelo 3 é executável antes do 1, não depois.** O doc diz que cobrança depende de empresa formalizada: verdade para cartão, **falso para TIP-20 push** — dá para receber o primeiro dólar on-chain sem entidade. (Ressalva honesta: sem entidade há exposição fiscal pessoal, zero blindagem de responsabilidade, e os Termos seguem com `[placeholder]`.)
- **Modelo 2 (freemium) é o errado para este estágio.** Freemium é funil e funil exige volume no topo. Com SAM de centenas de contas (§2.5), freemium queima o único ativo real: contato direto do founder. Trocar por **trial de 30 dias com onboarding guiado**, pago desde o dia 1.
- **Executável primeiro: modelo 1, a preço mais alto, com cobrança manual e zero código de billing.** "Sem código de cobrança" é feature até ~20 clientes.

### 2.3 A âncora de preço está no balde errado

Ancorar em Cryptocurrency Alerting (US$0 / 7,99 / 39,99 / 99) coloca o VILIGION no balde de *app de alerta de preço*. O produto não vende notificação, vende **redução de perda em evento de coação**. Ancore como fração do valor protegido e **ocupe de propósito as duas ordens de magnitude vazias** entre US$99/mês e o ACV institucional >US$50k — esse vazio é o posicionamento real da tabela §1.2.

| Plano | Preço proposto | Justificativa |
|---|---|---|
| Free | US$0 — e-mail, 1 endereço, 1 destinatário | É o canal que custa ~0; aquisição, não produto |
| **Guard** | **US$49/mês por endereço** — ligação, PIN, até 3 destinatários | Bate o teto do concorrente consumer entregando o que ele não tem. Tesouraria de US$100k paga 0,59%/ano |
| **Treasury** | **US$199–399/mês** — multi-endereço, escalonamento A→B→C, export de auditoria, RPC dedicado | Primeiro ponto onde venda founder-led é racional: LTV 18m ≈ US$3,6–7,2k sustenta CAC US$500–1k. Ainda ~1/100 do ACV institucional |
| Setup | US$500–1.500 one-time no Treasury | Paga a integração, filtra curioso, gera caixa antes do MRR |

**Rotular na submissão: "preço proposto, nenhum cliente citou número ainda."** A pergunta de disposição a pagar existe no script da Fase 1 §3 e nunca foi feita. Preço defendido-mas-não-validado lê muito mais forte que preço ausente.

### 2.4 Unit economics: o limitante não é demanda, é **CAC vs. preço**

A afirmação "o fator limitante é demanda, não custo" (§1.4) está direcionalmente certa e esconde três coisas:

1. **Custo fixo não é linha plana, é função escada.** "RPC Tempo gratuito" é verdade em n=1 e falso em n=50 — o próprio `PRODUCT-FEASIBILITY.md` item 3 já marca RPC por usuário como gargalo de rate-limit. RPC pago é US$49–199/mês: salto de 5–20× sobre o fixo declarado.
2. **Faltam itens na tabela §1.4:** domínio, SMTP transacional, processamento de pagamento (Stripe 2,9%+30¢ = **4,4% da receita num plano de US$20**), incorporação + registered agent, e LGPD/GDPR como **controlador** de dados (DPA, política de privacidade, processo de titular) para telefones de terceiros. E **número Twilio BR exige CNPJ** — dependência direta da formalização.
3. **A US$20/mês, LTV 24m = US$480 ⇒ CAC tem de ficar <US$150**, e hora de founder vendendo plano de US$20 é economicamente irracional. O mercado é pequeno demais para PLG self-serve e o preço é baixo demais para venda assistida. **Resolve-se subindo preço (§2.3), não cortando custo.**

### 2.5 TAM/SAM/SOM **[EST]** — com o método que substitui a estimativa por medição

Base factual pública: Tempo processou 3,9M transações em **177.000 endereços** nas 10 primeiras semanas de mainnet; ~**5.500 endereços ativos/dia** e ~**2.200 novos/dia** (DefiLlama); >**US$1B** de volume de transferência em 30 dias; **US$738M** em stablecoins on-chain e TVL ~US$44,8M (07/10/2026).

| Premissa **[EST]** | Valor |
|---|---|
| A — extrapolar 2.200 novos/dia até ~7 meses de mainnet | ~400–500k endereços cumulativos |
| B — endereços por entidade distinta (hot/cold, por-pagamento, contratos): 5–10 | 40–100k entidades |
| C — % que são negócios (não retail, não infra/bot): 10–20% | 4–20k |
| D — % que **retém** saldo em vez de varrer no mesmo dia (Tempo é chain de fluxo): 15–25% | 600–5.000 |
| E — % sem time de segurança **e** com saldo ocioso >US$25k: 20–40% | **120–2.000 contas** |

**SAM hoje [EST]: ~100–2.000 contas. A US$100/mês blended ⇒ ARR de SAM US$120k–2,4M.** É pequeno. Diga isso em voz alta — é mais forte que fingir.

**SOM 12 meses [EST]:** 1–3% para founder solo sem distribuição ⇒ **alvo honesto: 10 contas × US$99/mês ≈ US$12k ARR até Q1/2027.**

**Bottom-up [EST]:** Discord/X de builders Tempo + times da trilha Tempo + tesourarias de DAO ⇒ **200–800 contas nomeáveis e contactáveis em 2 semanas**; a 2–5% ⇒ 4–40 trials, 2–10 pagantes. **Converge com o top-down — é a convergência que se apresenta, não cada número isolado.**

**Contra-sinal que o plano não registra:** a população de negócios *nomeada publicamente* na Tempo é enterprise — DoorDash, Visa, Stripe, Shopify, UBS, Standard Chartered, Fifth Third, MoneyGram, Deel, SoFi — exatamente o segmento que **tem** time de segurança e compra Hexagate. A fatia PME pode ser a mais fina da Tempo especificamente. Isso torna o multi-chain (`PRODUCT-FEASIBILITY.md` item 11) **não um stretch de pitch, mas a correção de TAM**.

**Tailwind compensatório, e é tese de timing real:** a Tempo está *fabricando* o que você monitora — parceria **BlackRock BUIDL** para saldo ocioso de empresa render on-chain, e **OUSD nativo** (30/09/2026, já ~64% da stablecoin supply da chain) para pagamento/tesouraria de negócios. Nada disso existia antes de 03/2026.

**Como medir em 48h, em vez de estimar** (você já tem `eth_getLogs` paginado e a ABI TIP-20):

1. **(2–4h)** Script one-off: varrer 30 dias de `Transfer` TIP-20 na mainnet, agregar por destinatário, computar saldo final, **duração de retenção** (sobrevive 7+ dias?) e nº de contrapartes. Saída: *"N endereços retêm >US$10k de TIP-20 por >7 dias."* **É exatamente o denominador que o plano admite não ter.**
2. **(1h)** Subtrair institucionais e contratos conhecidos (lista pública de parceiros, vault BUIDL, PSPs). Resto = candidatos.
3. **(2h)** Amostrar 20 e checar quantos são contactáveis (label, X/GitHub, domínio).
4. Publicar número + método + script no repo. **Ressalva a declarar:** saldo retido ≠ negócio ≠ disposição a pagar.

⚠️ **Não rode isso hoje.** Maior impacto absoluto, pior razão impacto/esforço sob o relógio. Na submissão ele entra como **método prometido para a semana 1**, e jurado premia método.

### 2.6 As 5 perguntas mais destrutivas de um jurado

1. **"Seu cliente é PME na Tempo. Os usuários nomeados da Tempo são DoorDash, Visa, Shopify e UBS. Cite um cliente do seu segmento."**
   → *Não consigo: zero pagantes, waitlist é o único sinal. A chain tem 7 meses e é enterprise-led — o segmento está se formando, não formado. O motor é núcleo+adaptador e já é agnóstico de chain: o segmento não é "PME da Tempo", é "quem autocustodia stablecoin sem time de segurança". Tempo é a cunha, porque TIP-403/`ReceivePolicyGuard` dá um sinal que ferramenta genérica não decodifica.* **Não inventar cliente.**
2. **"A ligação é o nome do produto. Ela já tocou?"** → ver Bloco A. É a pergunta que decide tudo.
3. **"Cryptocurrency Alerting já liga, em 8 chains, por US$7,99–99. O que impede de adicionarem Tempo num sprint?"**
   → *Nada impede — integração de chain não é o moat e não vou alegar que é. O difícil de copiar é o threat model como restrição de produto: conteúdo sempre genérico (garantido por teste automatizado, não por revisão), prova EIP-191 de propriedade no cadastro, destinatário armazenado separado sob AES-256-GCM, e PIN que confirma sem nunca autorizar movimento de fundo. Um incumbente construído em torno de "me avise quando o saldo bater US$X" teria de quebrar o próprio produto. Moat fraco-a-médio, 12–18 meses.*
4. **"Qual é o preço, e quem te disse esse número?"** → §2.3, com o rótulo de não-validado.
5. **"Solo, pré-receita, pré-entidade, KMS é `LocalDevKeyProvider`, e perder o TOTP é lockout permanente. Por que isso é empresa e não projeto de fim de semana?"**
   → *Hoje não é empresa — é um sistema funcionando com 235 testes, validado contra a testnet Moderato real, repo MIT público, e uma lista explícita do que falta (issue #9 KMS, recuperação de conta, cobrança) com cada item travado por gatilho, não por data. A alegação não é "estamos prontos", é "sabemos exatamente o que não está e em que ordem". O bus factor é real e não mitigado além de documentação.*

*Menção honrosa, já auto-declarada no README:* "vocês recomendam número dedicado mas não provisionam — a história de wrench attack depende de algo que vocês não garantem."

### 2.7 Founder solo: o risco está subavaliado como "médio"

Documentação reduz bus factor de **conhecimento**, não de **operação**. Se o founder fica inalcançável 72h: quem redeploya? quem rotaciona token Twilio vazado? quem atende o cliente cuja ligação não disparou? Para um produto cuja promessa é *"vamos te alcançar quando importar"*, **operador único é defeito de produto, não só lacuna de staffing**.

Mitigações baratas, sem contratar: (a) runbook com uma segunda pessoa nomeada — basta alguém que saiba apertar redeploy e publicar status; (b) **tornar o health check da issue #8 externamente visível** (status page), para o cliente detectar falha independente do founder; (c) uptime monitoring externo que pagine o founder — *quem monitora o monitor*; (d) os Termos já negam SLA: **dizer isso na venda**, não esconder.

### 2.8 Captação — o quê pedir, quando, com que métrica

| Alvo | Quando | O ask | Métrica na mão |
|---|---|---|---|
| **Colosseum Accelerator** (US$250k/time; coorte 5: 21 de ~3.000 ⇒ 0,7%) | Entrevista pós-hackathon | Nada a pedir — você não aplica, **é entrevistado**. O que você controla é a submissão | Ligação tocando **em vídeo** + número on-chain medido + N na waitlist + N entrevistas |
| **Fundo de US$2,5M** (anexo ao ciclo) | Mesmo pipeline | Mesmo funil, não ask separado | Idem |
| **Stablecorp** (30% off incorporação + banking USDC, perk do hub) | **Dia seguinte à submissão — incondicional** | Chamada grátis de 30min de entity setup | **Nenhuma. É o ponto.** ~2 semanas e algumas centenas de dólares, e destrava quatro coisas: número Twilio como empresa, qualquer cobrança, os `[placeholder]` dos Termos, e DPA com cliente que tenha advogado. **Contestação ao plano: não é item condicional de Fase 1, é caminho crítico** |
| **Tempo (ecossistema)** — tem unidade de advisory e programa enterprise | Semana seguinte | **Grant de ecossistema + listagem no diretório de tooling.** Não dilutivo | O decoder TIP-403 MIT é exatamente o bem público que esse tipo de programa financia |
| **Anjo/pre-seed fora da Colosseum** | **Não agora** | — | Com 0 clientes e SAM de US$120k–2,4M [EST], você levanta em cima de história e fixa preço ruim. **Gatilho: 10 pagantes, ou 3 a ≥US$199/mês.** Antes disso o cheque de US$250k é o único capital que faz sentido, porque vem com a distribuição que falta |

---

## §3. Mercado

### 3.1 Panorama competitivo — a tabela atual está incompleta

| Concorrente / substituto | Oferta | Lacuna vs. VILIGION |
|---|---|---|
| **Cryptocurrency Alerting** | Free / ~US$7,99 / 39,99 / 99 mês; Wallet Watch; **ligação já existe**; 9 canais | Não suporta Tempo; sem desenho anti-coação. **Concorrente direto mais próximo** |
| **Tenderly Alerts** | Alertas real-time em balance change, eventos, invariantes; multi-chain; self-serve | Sem ligação; voltado a dev, não a dono de PME |
| **OpenZeppelin Monitor** (open source, Docker, qualquer EVM) | Grátis, self-host | Exige equipe técnica. ⚠️ **Defender foi desligado em 01/07/2026 — não citar como ativo** |
| **Chainalysis/Hexagate, TRM, Elliptic, Blockaid, Range, TRES** | Institucional, ACV alto | ⚠️ **Todos são parceiros oficiais do ecossistema Tempo** (§0.4). Recorte defensável = **segmento + preço**, nunca cobertura de chain |
| **Fireblocks / BitGo / Turnkey** (também na Tempo) | Alerta nativo de política em custódia | Exige mover custódia pra eles |
| **Forta / Forta Firewall** | Detecção e bloqueio pré-execução | Infra para rollups/protocolos, não para dono de tesouraria |
| **Bot de Telegram + webhook DIY + "olhar o dashboard"** | Grátis | **É o verdadeiro incumbente.** O concorrente nº1 de uma PME é não monitorar nada |

**Ameaça mais séria em 12 meses: Cryptocurrency Alerting adicionar Tempo.** Já tem ligação, base de clientes, preço de PME e 8 chains — adicionar uma 9ª EVM é trabalho de semanas. Segunda: **a própria Tempo** lançar webhooks/alertas nativos (o Indexer API já existe). **Adicionar as duas ao §4 de riscos do plano.**

**Conclusão desconfortável e honesta:** nem o canal de ligação nem o suporte à Tempo são defensáveis. O único fosso é o **desenho de privacidade contra coação** — copiável, mas hoje ninguém copia porque ninguém nomeia essa ameaça. **O fosso real a construir é confiança + distribuição no nicho, não feature.**

### 3.2 Tempo: pioneirismo com fundamento, mercado pagante hoje praticamente zero

US$738M em stablecoins (10º entre chains) são tesourarias de consórcio (Visa, Mastercard, BlackRock via OUSD) e protocolos DeFi — não PME sem time de segurança. ~4,7–5,5k endereços ativos/dia significa que o TAM atual de "PME com tesouraria TIP-20" está na casa de **dezenas, não milhares**. As quatro payment chains somadas (~US$2,7B) são **<1%** do mercado global de US$307,8B.

O que torna a aposta racional não é o tamanho hoje: (a) backing Stripe/Paradigm (US$500M Series A, US$5B valuation) com distribuição embutida; (b) o core genérico EVM já existe (`evm-adapter.ts` + adapter por chain), então **Tempo é cunha, não aposta única**. **Diga isso no pitch** — é mais forte que fingir mercado.

### 3.3 Segmentação — o beachhead não é quem o plano diz

- **A) Cripto-nativos do próprio ecossistema Tempo (BEACHHEAD).** Startups de pagamento/issuance/ramp já na Tempo: MeshPay, Levl, Wirex, **Avenia (brasileira)**, Daimo, El Dorado. 5–50 empresas, 2–20 pessoas, tesouraria TIP-20 real, **zero time de segurança**, zero custo de educação sobre o que é TIP-403. Alcançáveis pelos mesmos canais do hackathon. **Atacar primeiro: é o único segmento onde o produto funciona hoje, sem multi-chain.**
- **B) Exportadores/agências/SaaS brasileiros recebendo USDT/USDC (segundo).** LatAm é o mercado de stablecoin que cresce mais rápido (+89% a/a); ~90% do fluxo cripto brasileiro é stablecoin. Dor real, idioma e fuso do founder, e o **número Twilio BR só faz sentido econômico e de entregabilidade se o cliente for BR** — ligar de número brasileiro para cliente francês é problema. Bloqueador: estão em TRON/Base/Polygon, não Tempo ⇒ exige o multi-chain da Fase 2.
- **C) HNW/family offices europeus (adjacente, não beachhead).** É onde o dado de wrench attack realmente está. Maior disposição a pagar pelo ângulo privacidade — mas é B2C e contradiz o ICP "PME". Registre como expansão.

**Para as 10–15 entrevistas da Fase 1: só B dá volume de entrevistas; só A dá cliente pagante em 2026. Faça as duas listas.**

### 3.4 Reenquadramento de ICP em uma frase (~15 min, maior retorno textual do dia)

De *"PME com tesouraria TIP-20 na Tempo"* para:

> **"quem autocustodia stablecoin sem time de segurança — Tempo primeiro, porque TIP-403 dá um sinal que ferramenta genérica não decodifica."**

É a única mudança que torna a pergunta de TAM sobrevivível, e é honesta: o motor **é** núcleo+adaptador. **Não alegar que multi-chain está construído.**

---

## §4. Design de produto e UX

### 4.1 🔴 Achado de produto mais importante: os limiares padrão não correspondem a nenhum preset

[`signup-service.ts:46`](../src/privacy/signup-service.ts#L46) define, para quem acaba de se cadastrar:

```ts
maxBalanceDropPct: 20, criticalBalanceDropPct: 50, windowMinutes: 10,
blockedTransferAlertThreshold: 1_000_000n, criticalBlockedTransferThreshold: 10_000_000n,
```

Com `TOKEN_DECIMALS = 6` ([`token-units.ts:2`](../src/engine/rules/token-units.ts#L2)), isso significa **e-mail a partir de US$ 1,00** e **ligação telefônica a partir de US$ 10,00** de transferência bloqueada. E `windowMinutes: 10` **não existe** em `WINDOW_CHOICES_MINUTES` (`[15, 60, 120, 360, 1440]`, [`threshold-presets.ts:49`](../src/engine/rules/threshold-presets.ts#L49)).

**Efeito direto na demo:** o usuário novo abre `/thresholds` e a tela marca **"Personalizado"**, não "Equilibrado" — a melhor tela do produto abre parecendo desconfigurada, e os presets parecem decorativos.

**Correção:** trocar por `{10, 30, 60, 2_000_000_000n, 20_000_000_000n}` (= preset Equilibrado). 5 linhas, fora de cripto, auth e do canal de alerta. **Se você aplicar uma só mudança de código hoje, aplique esta.**

### 4.2 UX do alerta crítico — o maior gap de produto do projeto

Hoje: ligação com `<Say>` genérico + `<Gather numDigits="4" timeout="10">`; PIN válido → "Confirmado. Acesse o painel." e desliga.

1. **Nada acontece depois de confirmar.** O usuário em pânico às 3h confirma e o produto desliga na cara dele. Sem ação de contenção, sem caminho curto para o painel. *Mínimo pós-submissão:* a ligação termina dizendo que um e-mail com o link acabou de sair, e o painel ganha um bloco "o que fazer agora" (mover fundos, revogar aprovações, acionar contato de confiança).
2. **O não-confirmado é descartado.** Se o PIN nunca é digitado (dormindo, ou **sob coação**), nada reitenta e ninguém mais é avisado. No modelo de ameaça de coação, **"o dono não confirmou" é o sinal mais valioso que o produto gera, e vai para o lixo.** Hoje todos os números são ligados **em paralelo** — não há escalonamento. **Escada de reitentativa + destinatário secundário após N minutos é a feature que transforma isso em produto de segurança, não notificação.**
3. **O PIN só significa "ouvi".** Não distingue "fui eu" de "não autorizei isso". Dois dígitos diferentes resolveriam — é o input de maior valor do produto inteiro. Mexe no TwiML: **pós-submissão**.
4. **Zero diferenciação sonora**, TTS dito uma vez, `timeout="10"`. Se o PIN vem por WhatsApp, 10s não dá tempo de trocar de app, ler e voltar. Recomendo 20s e repetir o prompt — **não hoje**, está no caminho da ligação.
5. **Custo do falso positivo = churn.** Não há como marcar um alerta como esperado nem afrouxar o limiar em um clique a partir de `/alerts`. Para um produto cuja moeda é uma ligação às 3h, um falso positivo por mês mata a confiança. **Não está em `PRODUCT-FEASIBILITY.md`.**
6. ⚠️ **Bug de idioma visível na câmera:** o default de locale é `en` ([`locale.ts:14`](../src/alerts/locale.ts#L14)), mas a frase final de confirmação é `<Say language="pt-BR">` **hardcoded** ([`webhook-server.ts:147`](../src/webhook-server.ts#L147)). Gravando em inglês, a última coisa que o jurado ouve sai em português. **Contorno de zero risco: gravar com `ALERT_LOCALE=pt` (já em `.env.example:75`), ou não narrar a frase final.**

### 4.3 Fricção de onboarding — os dois gargalos não são de segurança

Funil real: landing → `/signup` exige extensão de carteira → assinar EIP-191 → usuário+senha → QR TOTP **mostrado uma única vez** → `/login` com 3 fatores → `/dashboard` vazio → descobrir sozinho `/accounts` → **colar o endereço do contrato do token** → `/recipients` → `/thresholds`. São **3 segredos novos e 3 configurações antes de qualquer valor entregue.**

- **O endereço do contrato do token.** A tela pede ao dono de PME que cole o contrato da PathUSD. Ele não sabe isso e vai colar a própria carteira nos dois campos — o bloco "Dois endereços diferentes, não confunda" prova que o problema foi percebido e resolvido **com texto em vez de design**. *Correção segura, pós-demo (~30 min):* `<select>` de tokens conhecidos por chain + pré-preencher "endereço monitorado" com o endereço **que o usuário já assinou no cadastro** (o dado existe, é só não pedir de novo). Zero impacto no modelo de ameaça.
- **Sem checklist pós-login.** `/dashboard` não avisa que faltam destinatários. Hoje dá para ficar logado, com conta monitorada, e **nenhum alerta sairia** — ninguém avisa.

**Seguro mexer:** ordem e rótulo de telas, pré-preenchimento, presets de token, copy, checklist no painel.

**NÃO tocar:** prova EIP-191 e nonce, TOTP obrigatório, hash de senha, PIN, validação de assinatura do webhook Twilio, política de conteúdo genérico. E **não construir recuperação por e-mail** — superfície de ataque nova; o caminho certo já está desenhado (login por carteira resolve recuperação de graça, item 12). A única mudança de auth que vale pós-submissão é **confirmar o TOTP antes de sair da tela de cadastro**, que elimina a classe de lockout "escaneei errado e nem sei".

### 4.4 Limiares: a melhor tela do produto, com três ressalvas

`/thresholds` tem presets com descrição em linguagem de dono, valores em US$, prévia com saldo real, simulador e selo de efeito imediato. **Um dono de PME consegue usar.** Mas: (a) **corrigir o default** (§4.1), sem isso os presets parecem decorativos; (b) **a unidade primária está errada** — o dono pensa em dólares, não em porcentagem; pós-submissão, deixar digitar *"me ligue se sair mais de US$ 20.000"* e derivar o `%` do saldo vivo (o padrão já existe para transferência bloqueada); (c) **"Janela de tempo" é jargão** → *"Período que somamos as saídas"*.

### 4.5 Melhorias de copy de **zero risco** (texto exato, se sobrar tempo)

| Onde | De | Para |
|---|---|---|
| [`views.ts:1105`](../src/dashboard/views.ts#L1105) | "Nenhum destinatário cadastrado ainda." | **"Nenhum destinatário cadastrado — hoje nenhum alerta sairia. Cadastre um telefone (ligação) e um e-mail (aviso) abaixo."** ← *o mais importante: o sistema fica mudo em silêncio* |
| [`views.ts:921`](../src/dashboard/views.ts#L921) | "Nenhuma conta monitorada ainda." | **"Nenhuma conta monitorada ainda — nada está sendo vigiado. Adicione a primeira abaixo, leva 30 segundos."** |
| [`views.ts:1157`](../src/dashboard/views.ts#L1157) | "Nenhum alerta ainda." | **"Nenhum alerta disparado. Quando um limiar for atingido, o evento aparece aqui com o canal usado e se o código foi confirmado."** |
| [`views.ts:113`](../src/dashboard/views.ts#L113) | nav "Limiares" | **"Quando avisar"** (a página já se chama "Quando você quer ser avisado") e mover `/recipients` **antes** de `/thresholds` — sem destinatário, limiar não serve pra nada |
| [`views.ts:273`](../src/dashboard/views.ts#L273) | — | acrescentar: **"Guarde este código num lugar seguro. Hoje, se você perder o autenticador, não há como recuperar o acesso — recuperação pela carteira está no roadmap."** Honestidade pontua com jurado e evita o pior ticket de suporte |

### 4.6 Gaps de produto por impacto — e quando

| # | Gap | Status em `PRODUCT-FEASIBILITY.md` | Quando |
|---|---|---|---|
| 1 | Default de limiar = preset válido | **ausente (novo)** | **Hoje** |
| 2 | Contenção + escalonamento pós-alerta | **ausente — proponho como item 13** | Pós, topo da Fase 1 |
| 3 | Loop de falso positivo ("isso fui eu") | parcial no item 4 (aquele é dado, este é UX) | Fase 1 |
| 4 | Recuperação de conta + login por carteira | itens 9+12, já prio 1 | Pós — concordo integralmente |
| 5 | Faixa "Monitorando · último ciclo há 12s" | UI-DESIGN-STUDY §6 | Pós |
| 6 | Histórico de alteração de limiar | THRESHOLDS §9 — **é controle anti-coação, não cosmético: subir acima do multi-chain** | Fase 1 |
| 7 | Horário de silêncio / teto diário de ligações | THRESHOLDS §9 | Fase 1 |

**Tudo de 2 a 7 é PÓS-submissão.**

### 4.7 Canal crítico sem número de telefone — CONSTRUÍDO em 2026-10-11

Decisão do founder: seguir com o plano de privacidade que **não depende da Twilio**. Implementado e testado hoje.

**A tese.** A ligação resolve "acordar o dono", mas cria o único dado do fluxo de alerta que não dá pra proteger depois: o número. Ele é atribuível à pessoa e sua retenção é regulatória, não configuração de fornecedor (Twilio 13 meses no Console e indefinido via Bulk Export; ANATEL Res. 426/05 exige mínimo de 5 anos de qualquer operadora no Brasil). Criptografar melhor a *nossa* cópia não ajuda — o registro não é nosso. Então a mitigação é tornar o dado desnecessário: **a propriedade de privacidade vem de o dado não existir.**

**O que foi construído:**

| Peça | Arquivo |
|---|---|
| Notifier de push, conteúdo pela mesma política genérica | [`src/alerts/web-push.ts`](../src/alerts/web-push.ts) |
| Validação e exibição segura da inscrição | [`src/dashboard/push-subscription.ts`](../src/dashboard/push-subscription.ts) |
| Service worker + manifest + script de registro | [`src/dashboard/pwa-assets.ts`](../src/dashboard/pwa-assets.ts) |
| Rotas `/sw.js`, `/manifest.json`, `/icon.png`, `/push/config`, `/push/subscribe` | [`src/dashboard/server.ts`](../src/dashboard/server.ts) |
| Despacho em paralelo à ligação, nos dois modos | [`src/index.ts`](../src/index.ts) |
| Geração das chaves VAPID | [`scripts/generate-vapid-keys.ts`](../scripts/generate-vapid-keys.ts) |

**Decisões de desenho que valem registro:**

- **Mesma tabela, mesma criptografia.** Entra em `alert_recipients` com `kind='push'`, sob o mesmo envelope AES-256-GCM do telefone. Um endpoint de push é uma **capacidade** (quem tem, notifica o dispositivo), não um identificador inócuo — não merece tratamento mais frouxo.
- **Nunca renderizado inteiro.** A tela mostra só o host do push service. Há teste automatizado garantindo que o endpoint e as chaves não aparecem no HTML.
- **Adiciona, não substitui.** Push e ligação são tentados de forma independente; o `return` antecipado que existia no dispatcher impediria o push e foi reestruturado. Se o push falhar, nada do que existia regride.
- **Capacidade ausente não finge existir.** Sem as chaves VAPID, as rotas respondem 404 e a tela não oferece a opção — mesmo padrão do `testAlert`.
- **O alerta de teste agora aceita quem só tem push**, sem telefone cadastrado — era justamente o ponto.

**Verificação:** 235 testes em 33 arquivos, 6 execuções consecutivas limpas. Além dos testes unitários (com sender fake), um **teste de integração real** com chaves VAPID geradas de verdade contra um push service local provou: JWT VAPID no header, `content-encoding: aes128gcm` (RFC 8291), urgency `high`, TTL 900s, topic em exatos 32 caracteres, e **corpo cifrado — nenhum texto claro no envio**.

**Pendências honestas, já escritas no README e no `SECURITY.md`:**

1. **Nunca exercitado em dispositivo real em produção.** A criptografia e a assinatura estão provadas; uma notificação entregue num aparelho, não.
2. **Rodar a migration em produção é obrigatório** — a constraint antiga de `alert_recipients` só aceitava `'phone'` e `'email'`, e o `migrate.ts` reescreve `CREATE TABLE` para `IF NOT EXISTS`, então num banco existente a definição nova seria ignorada. O schema agora termina com `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, idempotente. **Sem isso, registrar dispositivo falha em produção e passa em qualquer teste com banco novo.**
3. **Ícone é 128x128.** Push funciona em Android/desktop sem instalar; o iOS exige adicionar à tela de início, e o prompt de instalação do Chrome quer 192px+. Gerar 192/512 é acompanhamento.
4. **Não é imunidade a ordem judicial, e não alegamos isso.** O que diminui é o conjunto de dados que temos a produzir. A afirmação defensável é minimização de dados — que LGPD/GDPR premiam — não que um ofício falha.

**Para o pitch:** isto é material de critério "Insight", e a frase verdadeira é *"o desenho alvo é alertar sem que exista um número para vincular — nem para nós"*. Não dizer "imune à justiça".

### 4.8 Teste intermitente corrigido (risco de CI vermelha na véspera)

`src/monitor.test.ts` tinha um teste que dormia 40ms fixos com `pollIntervalMs: 5` e precisava de 3 ciclos de poll. Passava 5/5 isolado e **quebrava ~1 em 3 na suíte completa**, com 33 workers disputando CPU. Não era mudança de hoje — é pré-existente, e "CI verde" é uma claim do pitch. Trocado por espera pela condição em vez de tempo de parede. Só código de teste; produção intocada.

---

## §5. Marketing, comunicação e submissão

### 5.1 Textos de submissão (EN) — **rascunhos estruturais, reescrever na sua voz**

Jurados leem esses campos como as palavras do time. Cada frase abaixo é checável no repo.

**(a) Tagline**

> Treasury monitoring for Tempo that calls the owner's phone — and is designed so the alert can't be used against them.

**(b) Descrição curta (~50 palavras)**

> VILIGION watches TIP-20 treasuries on Tempo and reaches the owner by real phone call when something critical happens — not a dashboard they have to stare at. Alert content never reveals balance or address, because linking a phone number to on-chain funds is itself a physical-security risk.

**(c) Descrição completa (~250 palavras)**

> A business owner holding stablecoin on Tempo has two bad options: watch a dashboard all day, or find out late. Institutional monitoring (Chainalysis/Hexagate, Elliptic, TRM Labs) is built for security teams with >$50k ACVs. Call-based alerting already exists for individuals — Cryptocurrency Alerting, $8–99/month — but doesn't support Tempo, and isn't designed against the threat that matters most here.
>
> That threat is physical. Coercion attacks tied to crypto ownership ("wrench attacks") are documented and growing: CertiK verified 52 incidents in H1 2026, **33% more incidents** than H1 2025, with $124.1M in recorded financial exposure; Chainalysis, using a narrower measure, counted 46 incidents and over $30M actually stolen. Two different methodologies, same conclusion: the moment you connect a phone number to a treasury balance, the alert channel becomes an attack surface.
>
> VILIGION is built around that. It reads TIP-20 balances directly over RPC (Viem), adjusting for Tempo's fee token so a transaction fee is never mistaken for a loss, and decodes real `TransferBlocked` events from `ReceivePolicyGuard`/TIP-403 using `ox/tempo`. Two detection rules run against thresholds each user sets privately. Critical severity goes out by phone call (Twilio Voice) with a single-use confirmation PIN; normal severity goes by email.
>
> The privacy design is the product: alert content never contains balance or address — enforced by automated test, not review. Address ownership is proven by EIP-191 signature at signup. Alert recipients are registered separately, after login, under AES-256-GCM envelope encryption. No custody, and no transaction is ever executed from a voice reply.
>
> 235 automated tests, no external audit yet. MIT, public repo, live demo at viligion.com.

**(d) Go-to-market (~150 palavras)**

> Demand signal today is a waitlist that asks one question — "what worries you most about your on-chain treasury" — and the answers are our interview script, not a guess. Next is 10–15 structured interviews with owners who already hold or are considering a stablecoin treasury, to test whether the pain is felt as a priority and what it is worth.
>
> Distribution follows the threat, not the chain. The buyer is an owner, not a security team, so the channel is where owners already read about being targeted: stablecoin payroll and payments tooling, accounting and OTC desks serving crypto-paid businesses, and the Tempo builder community itself — every team shipping TIP-20 payments has a treasury to watch and is a referral path, not a competitor.
>
> Proposed pricing is monthly per monitored address: email alerts free, phone calls from $49, multi-recipient escalation from $199. No customer has named a number yet — that is what the interviews are for. Fixed cost is ~$10–11/month and marginal cost per customer is cents, so the constraint is demand, not unit economics.

**(e) "What existed before Sept 14" — verificado hoje**

> Nothing. The repository's first commit is 2026-10-02 and all 61 commits to date are from October 2–10, 2026, inside the competition window — `git log --reverse` on the public repo confirms it, and `git log --until=2026-09-14` returns empty.
>
> Third-party open source composed with (not written by us, and not claimed as ours): Viem and `ox/tempo` for Tempo RPC and TIP-403 event decoding, Twilio's SDK for voice, and Node/TypeScript tooling. Everything in `src/` — detection engine, privacy layer, delivery layer, dashboard — was written during the hackathon.

**Esse campo é vantagem sua: 100% dentro da janela é a resposta mais limpa possível. Não enfeite.**

### 5.2 Vídeo: o erro mais caro do roteiro atual

**O telefone tocando — o único momento que ninguém mais tem — aparece em 1:45 do vídeo 2, atrás de cadastro, QR code e thresholds.** Jurado que vê formulário antes do telefone já formou a impressão "mais um dashboard". O vídeo 1 abre com estatística: número não é gancho, **som é**. E o roteiro mantém dois caminhos ("se validado / se não validado") até a hora de gravar — isso vira hesitação na câmera. **Decida no Bloco A.**

**Cold open proposto (vídeo 2, demo ≤3min):**

- **0:00–0:20** — Painel parado, silêncio. **O telefone toca na mesa, no enquadramento.** Você atende, a voz fala o alerta genérico, você digita o PIN. Zero narração até aqui. Só então: *"Isso foi um alerta crítico do VILIGION. Você não ouviu saldo nem endereço — nem quem estiver ao meu lado ouviu."*
- **0:20–0:40** — Por que o conteúdo é genérico: uma frase sobre wrench attacks, uma sobre o canal de alerta virar superfície de ataque.
- **0:40–1:20** — O que causou a ligação: `npx tsx scripts/verify-testnet.ts` na tela, `TransferBlocked` real decodificado da testnet Moderato, `blockedReason`/`kind`/`memo`.
- **1:20–2:10** — Só agora o portal, rápido: `/accounts` (monitor sobe na hora), `/recipients` (destinatário criptografado), histórico mostrando **o alerta da abertura**. Fecha o ciclo.
- **2:10–2:40** — `npx vitest run`: **235 testes verdes**. Repo público, MIT.
- **2:40–3:00** — Uma frase sobre o que falta e quando (KMS gerenciado antes de qualquer cliente real).

**Vídeo 1:** inverter a abertura — começar com *"construí uma coisa que liga pro meu telefone, e o maior problema de engenharia foi garantir que a ligação não possa ser usada contra mim"*, e só então os números. Founder solo: primeira pessoa, sem desculpa.

**O que NÃO mostrar:**

- **WhatsApp entregando o PIN** — `TWILIO_WHATSAPP_CONTENT_SID` não está configurado. PIN falado funciona e é suficiente.
- **KMS gerenciado, número virtual dedicado, detecção de "padrões de transferência"/z-score.** Os três são proibidos pelo `SECURITY.md` e derrubam a credibilidade inteira se um jurado abrir `src/privacy/encryption.ts`.
- **Canal de e-mail como "funcionando"** — SMTP não está configurado em produção (`[alertas] canal normal (e-mail): NÃO configurado`).
- **A frase final da ligação em português** num vídeo em inglês (§4.2, item 6).
- **O login da conta demo em tela** (§5.4). E assine `/signup` com carteira de teste, nunca a sua real.
- **A raiz do repo em tela** — `.tmp-prod-check.mjs` tem credenciais de produção. Está em `.gitignore` (`.tmp-*`) e **não versionado** (confirmado com `git ls-files`), então não há exposição pública — mas não grave a pasta.

### 5.3 Go-to-market concreto — canais, em ordem de custo/retorno

1. **Discord da Colosseum, canal da trilha Tempo** — não para divulgar: para **oferecer monitoramento grátis do contrato de teste dos outros times**. Cada time Tempo tem tesouraria de teste e zero visibilidade sobre ela. São seus primeiros 5 usuários reais, e vêm esta semana.
2. **Tempo builder community / loop de feedback de docs** — você achou comportamento real (transferência bloqueada emite recibo em vez de reverter). Quem indexa `ReceivePolicyGuard` em produção hoje é público pequeno e identificável.
3. **Provedores de folha de pagamento e pagamentos em stablecoin** — eles **criam** a tesouraria que você monitora. Integração/indicação, não concorrência.
4. **Contadores e escritórios que atendem empresa paga em cripto** — canal chato, altíssima conversão; é quem o dono já escuta.
5. **A waitlist que você já tem**, com o campo "o que mais te preocupa" preenchido. É o seu único dado de demanda real — **use no campo de GTM**.

**Ângulo de conteúdo sobre wrench attack, sem virar manual de atacante:** números agregados e fontes públicas (Chainalysis, CertiK), nunca caso individual, nunca método. O conteúdo é sobre **o canal de alerta**, não sobre o ataque: *"se o seu monitor te manda SMS dizendo 'saldo caiu para X', quem lê a sua tela sabe que você tem X"* — isso é educação de design. **Nunca publicar** nada sobre como identificar quem tem tesouraria, como forçar um alerta, ou onde os limiares ficam (o `SECURITY.md` já admite que são "obscured, not secret" — não ajude). Tom seco e operacional: alarmismo em segurança queima credibilidade com exatamente o comprador que você quer.

### 5.4 🔴 Risco de comunicação nº 1: as credenciais demo no README

Hoje o README publica usuário, senha **e o segredo TOTP em texto puro** de uma conta demo compartilhada.

**Avaliação: prejudica mais do que ajuda, e o custo é assimétrico.** O benefício é real mas pequeno (jurado entra sem atrito). O custo é que você é uma **empresa de segurança publicando um segredo TOTP no README** — exatamente a classe de erro que o seu próprio `SECURITY.md` promete não cometer. O README **contradiz literalmente a sua própria política, na mesma página** que um jurado lê para avaliar "Product + Execution". O disclaimer não resolve: o problema não é o dado sintético, é demonstrar que o segundo fator vira teatro quando é conveniente. **Pior:** qualquer visitante pode cadastrar um destinatário e disparar ligações da sua conta Twilio **na véspera do julgamento**.

**Recomendação (15 min):** tirar as credenciais do README → *"Live demo at viligion.com. Judges and reviewers: credentials on request, or see the demo video for the full flow."* e colocar as credenciais **no campo da submissão**, que é privado aos jurados. Preserva 100% do benefício, elimina o risco. Rotacionar a senha depois do julgamento.

### 5.5 Outros riscos de comunicação

- **"235 testes" pode ser lido como garantia de segurança.** Diga **"235 testes automatizados, nenhuma auditoria externa ainda"** — a segunda metade é o que faz a primeira ser acreditada. Teste de cliente ou binário verificado **não é** auditoria.
- **`TERMS-OF-USE.md` tem `[placeholder]` em entidade legal, jurisdição e limitação de responsabilidade.** Termos no ar sem entidade, para um produto que promete alertar sobre perda de dinheiro, é exposição real. O aviso no topo mitiga para o jurado, **não mitiga juridicamente**. Caminho: Stablecorp (§2.8).
- **"Potential Market Size" é critério de julgamento e você não tem o número.** **Diga o número que não tem** e que descobrir isso é o item 1 da Fase 1, com o método do §2.5. O plano já faz isso bem. Estimar aqui é o único jeito de perder o ponto.
- **Risco operacional de hoje:** o `rpc.tempo.xyz` caiu às 15:38 UTC de 11/10 (Cloudflare 521) e o monitor registrou falha consecutiva. Voltou (HTTP 200, bloco `0x29a73b2`), mas **não há RPC de fallback configurado** — `resolveRpcUrl` cai no `defaultPublicRpcUrl`. Se cair durante a gravação, a demo morre na câmera. **Tenha um RPC alternativo à mão e grave o `verify-testnet.ts` o quanto antes.**

### 5.6 Relações exteriores — contatos, com pedido e gancho

| Entidade | Pedido específico | Por que responde |
|---|---|---|
| **Time/devrel da Tempo** | Validar as premissas do `verify-testnet.ts`: endereço do `ReceivePolicyGuard`, semântica de `TransferBlocked`, e se há caminho suportado de webhook/indexer em vez de `eth_getLogs` paginado | Você é usuário real e antecipado de TIP-403 e achou um bug de leitura nativo-vs-TIP-20 no processo. Chain de 7 meses quer esse feedback |
| **Colosseum Accelerator** | **Nada agora** — a submissão **é** a aplicação (shortlist → painel → Zoom de 15min). Prepare a entrevista | Caminho oficial único. Contato paralelo queima |
| **Stablecorp** | Agendar a chamada grátis de 30min de entity setup; usar 30% off na incorporação + EIN/KYB prioritários | Perk oficial de builder da Colosseum. Resolve o bloqueio que os Termos listam como `[placeholder]` e que impede cobrar |
| **Chainalysis / CertiK (research)** | Você cita os dados deles publicamente — avise, peça revisão da citação, ofereça o caso de uso | Research team adora citação correta. Gancho barato, retorno em credibilidade |
| **Carteiras/custódia na Tempo** (Tempo Wallet, Turnkey, Privy) | Conversa técnica: monitoramento como camada sobre a carteira deles, não competindo | Eles têm o usuário e não têm alerta fora do app. **Você não toca chave privada** — argumento que remove o obstáculo todo |
| **Twilio startup/ISV program** | Aprovação do template de WhatsApp (`CONTENT_SID`) + crédito | Desbloqueia a entrega do PIN. Pedido pequeno, resposta rápida |
| **Cryptocurrency Alerting** | **Nenhum contato.** Citar com respeito no vídeo pontua; abordar sem produto maduro só entrega roadmap | — |
| **Imprensa cripto nichada** (The Defiant, Blockworks — repórter de segurança, não de preço) | Nada antes de 1 usuário real em produção. Então: ângulo "canal de alerta como superfície de ataque", não "lançamos um produto" | Lançamento de hackathon não é pauta; design de segurança é. Guarde a bala |

---

## §6. Pós-submissão: o que separa projeto de empresa

**Ordem, com gatilho em vez de data:**

1. **Stablecorp, dia seguinte à submissão, incondicional** (§2.8). Caminho crítico, não item condicional.
2. **Twilio: conta paga + número como empresa** (depende de 1 para CNPJ).
3. **KMS gerenciado** (issue #9) — **antes de qualquer dado de cliente real**, não negociável.
4. **Medir o mercado na chain** (§2.5) — 48h de trabalho que converte a maior lacuna do pitch em número próprio.
5. **10–15 entrevistas** com as duas listas do §3.3 (A para pagante, B para volume), com a pergunta de WTP que nunca foi feita.
6. **Escalonamento + contenção pós-alerta** (§4.2, itens 1 e 2) — a feature que faz disso produto de segurança.
7. **Recuperação de conta via login por carteira** (itens 9+12) — resolve lockout sem criar superfície nova.
8. **Multi-chain (item 11) sobe de prioridade**: não é stretch de pitch, é correção de TAM (§2.5).

### Kill criteria — escrever isto na submissão (~10 min, custo zero, lê como seriedade incomum)

> Se 15 entrevistas não produzirem ninguém que cite espontaneamente ≥US$49/mês, pivotamos canal ou segmento — não o preço.
>
> Se a contagem on-chain mostrar <50 endereços retendo >US$10k de TIP-20 por >7 dias, o beachhead passa a ser multi-chain EVM, não Tempo.

O `VALIDATION-PLAYBOOK` §5 já diz "se o resultado for fraco, diga". Basta estender ao plano de negócio.

---

## §7. Veredito de viabilidade

**Viabilidade técnica: alta e comprovada.** 235 testes verdes, núcleo validado contra a rede real, bug de leitura de saldo encontrado e corrigido no processo, produção no ar, repo MIT limpo. Para um hackathon de 5 semanas com founder solo, a execução é o ponto mais forte do projeto — e os critérios de julgamento premiam Product+Execution.

**Viabilidade de negócio: não demonstrada, e isso é consertável hoje por honestidade, não por dado.** O SAM estimado (US$120k–2,4M ARR [EST]) é pequeno; o mercado pagante na Tempo hoje é ~zero; o segmento nomeado da chain é enterprise, não PME. Nada disso é fatal **se o pitch disser exatamente isso** e apresentar o método de medição em vez de uma estimativa confiante. O que seria fatal é afirmar um TAM que o jurado derruba em dois cliques.

**O fosso real não é o canal de ligação nem a Tempo** — nenhum dos dois é defensável. É o **threat model como restrição de produto**, e ele vale 12–18 meses de vantagem porque ninguém mais nomeia essa ameaça. O fosso duradouro a construir é **confiança + distribuição no nicho**.

**O que decide a submissão de hoje, em uma frase:** fazer a ligação tocar (Bloco A), corrigir os seis fatos do §0, e gravar o vídeo começando pelo telefone. O resto deste relatório é Fase 1.

---

### Anexo — evidências verificadas em 2026-10-11

| Verificação | Resultado |
|---|---|
| `npm test` | 33 arquivos, **235 testes**, todos passando (6 execuções consecutivas limpas) |
| `git rev-list --count HEAD` | **61 commits**; primeiro em 2026-10-02; `git log --until=2026-09-14` **vazio** |
| Árvore de trabalho | limpa, `master` sincronizado com `origin/master` |
| Produção (Railway) | deploy `c22cd5ae` SUCCESS; commits posteriores alteram **só docs** |
| Log de alerta crítico | `2026-10-10T00:03:03Z` balance-drop critical, **dispatcher Postgres** |
| Causa da falha de entrega | commit `d0575d1`: **conta Twilio trial, `outgoing_caller_ids` vazio** |
| `alert_recipients` | funciona — nenhum erro de relação, nenhum "nenhum telefone cadastrado" |
| `rpc.tempo.xyz` | 521 às 15:38 UTC; depois HTTP 200, bloco `0x29a73b2`. **Sem fallback** |
| `viligion.com` e `/healthz` | HTTP 200 |
| `tempo.xyz/ecosystem` | Blockaid, Chainalysis, Elliptic, Range, TRES, TRM Labs, BitGo, Fireblocks, Turnkey |
| `TOKEN_DECIMALS` | 6 ⇒ default de ligação = **US$ 10,00** |
| `windowMinutes: 10` | **não existe** em `WINDOW_CHOICES_MINUTES` |
| `.tmp-prod-check.mjs` | ignorado por `.gitignore:24`, **não versionado** |
| Prazo Colosseum | `2026-10-13T06:59:00Z` = 12/10 23:59 PT |

**Não verificado:** o que um jurado vê no histórico de alertas da conta demo (o login foi bloqueado por política de credenciais nesta sessão). Vale você conferir se o alerta de 10/10 aparece como `delivery-failed`, já que as credenciais estão no README.

**Fontes externas:** [CertiK Wrench Attacks 2026](https://www.certik.com/blog/2026-wrench-attacks-overview) · [Decrypt — CertiK $124M](https://decrypt.co/374136/crypto-wrench-attacks-cost-victims-124m-in-six-months-up-12x-certik) · [Decrypt — Chainalysis $30M](https://decrypt.co/375014/crypto-wrench-attacks-30m-stolen-2026-chainalysis) · [Tempo Ecosystem](https://tempo.xyz/ecosystem/) · [DefiLlama — Tempo](https://defillama.com/chain/tempo) · [Coincub — Stablecoin Blockchains](https://coincub.com/blog/stablecoin-blockchains/) · [Tempo enterprise](https://tempo.xyz/blog/enterprise/) · [Tempo + BlackRock BUIDL](https://finance.yahoo.com/markets/crypto/articles/tempo-brings-blackrock-buidl-businesses-115730008.html) · [OpenZeppelin Defender sunset](https://www.openzeppelin.com/news/defender-sunset-faq) · [Colosseum Accelerator Cohort 5](https://blog.colosseum.com/announcing-colosseums-accelerator-cohort-5/) · [Colosseum prêmios + fundo](https://cryptobriefing.com/colosseum-crypto-worlds-fair-hackathon/) · [Tenderly Monitoring](https://tenderly.co/monitoring/) · [Cryptocurrency Alerting](https://cryptocurrencyalerting.com/wallet-watch.html)
