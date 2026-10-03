# Arquitetura

## Princípio de design

**Núcleo genérico + adaptador por chain**, não um motor "universal". A lógica de detecção de saldo/padrão é compartilhável entre chains EVM (Tempo, Base, Arbitrum, Ethereum L1), mas regras específicas de protocolo — como decodificar eventos do `ReceivePolicyGuard` (TIP-403) da Tempo — **não existem** nas outras chains e vivem isoladas no adaptador.

## Módulos

### 1. `/engine` — Motor de detecção
- `chains/evm-adapter.ts` — leitura de saldo/eventos via RPC (Viem), genérico entre chains EVM.
- `chains/tempo.adapter.ts` — específico da Tempo: decodifica eventos do contrato `ReceivePolicyGuard`; trata o fato de que a Tempo não tem gas token nativo (fee sai do próprio TIP-20, o que exige diferenciar dedução de taxa de saída real de valor).
- `rules/detection-rules.ts` — lógica de regras **aberta** (ex: "queda percentual", "transferência redirecionada pro Guard"). Os limiares numéricos exatos de cada usuário ficam fora deste arquivo, em configuração privada por usuário.

Fonte da verdade: RPC direto via Viem, não a Indexer API da Tempo (que a própria documentação oficial descreve como "ainda evoluindo"). A Indexer é usada apenas para funcionalidades secundárias do painel (histórico, analytics), nunca no caminho crítico do alerta.

Proteção contra reorg: alerta só dispara após profundidade mínima de confirmação.

### 2. `/privacy` — Camada de privacidade
- `encryption.ts` — método de criptografia do vínculo telefone↔endereço (AES), documentado publicamente; a **chave** vive em KMS gerenciado (nunca no mesmo ambiente do banco de dados).
- `ownership-proof.ts` — exige assinatura (`signMessage`/`recoverAddress` via Viem) no cadastro, provando que quem registra o telefone controla de fato o endereço.
- `alert-content-policy.ts` — regra rígida: nenhum valor monetário ou endereço sai no conteúdo do alerta por voz/SMS, sob nenhuma circunstância.

### 3. `/alerts` — Camada de entrega
Dois canais, escolhidos por **severidade** (`DetectionEvent.severity`, decidida em `detection-rules.ts` a partir de um segundo limiar "crítico" por tipo de evento) — não toda anomalia justifica o custo e a exposição de uma ligação:

- `twilio-voice.ts` — severidade **critical**: ligação telefônica real via Twilio Programmable Voice.
  - `twilio-webhook-validator.ts` — valida o header `X-Twilio-Signature` em todo endpoint que recebe resposta — sem isso, qualquer pessoa que descubra a URL do webhook pode forjar confirmação de PIN.
  - PIN é de **uso único**, atrelado a um ID de alerta específico, nunca reaproveitável.
  - Múltiplos destinatários configuráveis (mitiga tanto fadiga de alerta/TDoS quanto o cenário onde um único destinatário é o próprio alvo de coação).
- `email-notifier.ts` — severidade **normal**: e-mail via SMTP genérico. Sem custo por mensagem, sem o problema de retenção de CDR de operadora (ver `SECURITY.md`). Reusa a mesma política de conteúdo (`alert-content-policy.ts`) — a garantia de "nunca revela saldo/endereço" vale pros dois canais igualmente.
- Ambos os clientes são **opcionais** em runtime (`index.ts`): sem Twilio/SMTP configurado, o alerta correspondente só loga no console em vez de travar a aplicação — permite rodar o monitor e validar detecção antes de ter conta Twilio.

### 4. `/dashboard` — Painel
- Login com MFA + rate-limiting (paridade de proteção com a camada de voz — não adianta proteger a ligação e deixar o painel com login simples).
- Único lugar onde saldo/endereço completo é exibido.

## O que é público vs. privado no repositório

| Público (neste repo) | Privado (nunca no repo) |
|---|---|
| Lógica de detecção e regras | Limiares numéricos configurados por usuário |
| Método de criptografia (como funciona) | Chave de criptografia em si |
| Schema de banco de dados | Dados reais de usuário |
| Integração Twilio (código) | Credenciais/API keys Twilio |
| Decodificador de eventos TIP-403/ReceivePolicyGuard | — |

## Roadmap: canal de push via PWA (pós-hackathon)

Avaliamos substituir a ligação telefônica por um app instalável (PWA) com push notification em background, motivado por reduzir dependência da Twilio. Decisão: **não substituir, só complementar depois**.

Por quê:
- O diferencial validado do produto (ver README.md e a pesquisa de mercado que embasou o pitch) é justamente **não exigir nenhum app instalado** — é isso que diferencia de Hexagate/Elliptic/TRM, que pressupõem usuário técnico engajado com ferramenta própria. Um app PWA reintroduz essa barreira exatamente pro público que o produto tenta servir.
- Ligação telefônica tem maior taxa de interrupção efetiva que push notification (toca/vibra vs. fica acumulado num badge que a maioria ignora) — para um alerta de segurança urgente, isso importa.
- O vazamento de dado sensível que motivou a ideia **já está mitigado** pela política de conteúdo genérico (`alert-content-policy.ts`) — a Twilio nunca vê saldo/endereço, só "ligar com frase genérica". Trocar de canal não resolve um problema que já foi resolvido na camada de conteúdo.
- Push também depende de terceiro (APNs/FCM) — não elimina dependência externa, só troca qual empresa vê metadado da entrega.

Se implementado no futuro, como canal **redundante adicional** (reforça a mitigação de TDoS já desenhada, múltiplos canais simultâneos) e não como substituição:
- PWA com Web Push API, não app nativo — loja de app (App Store/Play Store) não é viável pra timeline de hackathon nem pra manter paridade de deploy rápido depois.
- Ressalva técnica real: push em PWA no iOS só funciona a partir do iOS 16.4+, e exige que o usuário tenha feito "Adicionar à Tela de Início" manualmente antes — taxa de adoção desse passo tende a ser baixa, então não deve virar o canal primário mesmo no futuro.

### Sub-ideia avaliada: som e vibração distintos por tipo de alerta (estilo "nudge" do MSN)

Avaliamos (2026-10-03) dar ao usuário um som/vibração característico por tipo de evento (`kind` × `severity`), pra reconhecer o que aconteceu sem nem olhar a tela. Vale implementar, mas só como parte do painel **aberto em foco**, não como notificação de sistema em segundo plano — duas limitações reais de plataforma:

- `navigator.vibrate()` não existe no iOS Safari (nunca foi implementado pela Apple) — funciona só em Android.
- Som customizado por categoria **não é suportado por nenhum navegador** em push notification de sistema (Chrome/Firefox/Safari sempre usam o som padrão do SO) — só funciona como JS comum tocando áudio, o que exige a aba já aberta e em foco.

Pré-requisito que ainda não existe: o `dashboard/server.ts` hoje é só API JSON (`/login`, `/details`) — não há página HTML nem canal de push em tempo real (SSE/WebSocket) do `dispatchAlert` até o navegador. Implementar o nudge exige construir essas duas peças primeiro, não é só adicionar arquivos de som. Escopo real: endpoint SSE streando eventos + página mínima do painel assinando esse canal + 2-4 sons distintos (crítico vs. normal, opcionalmente por `kind` também).

Decisão: tratar como item de roadmap pós-hackathon junto com o push via PWA, não construir antes do prazo de submissão — prioridade agora é validar contra a rede real, gravar os vídeos e completar a submissão.

## Limitações conhecidas (documentadas por honestidade, não escondidas)

- Limiares calibrados em testnet (Moderato) não necessariamente generalizam para mainnet — comportamento de saldo em testnet é mais ruidoso (faucets, scripts de teste).
- Dependência de disponibilidade da Twilio e do RPC da Tempo.
- Sandbox do WhatsApp (se usado em demo) é um número compartilhado publicamente conhecido da Twilio — válido apenas para demonstração, não para produção.

## Lacunas de arquitetura (auditado em 2026-10-03, nenhuma escondida)

Revisão do repositório encontrou peças descritas na documentação (ou já com lógica/schema prontos) mas que ainda não estão conectadas ponta a ponta:

- **Persistência Postgres construída, ainda não ligada em `index.ts`/`dashboard/server.ts`** (atualizado 2026-10-03): `db/postgres-repositories.ts` tem `PostgresPhoneMappingRepository`, `PostgresMonitoredAccountRepository` e `PostgresAlertLog`, testados (`Queryable` injetável, sem precisar de Postgres real no teste), com `scripts/migrate.ts` aplicando `privacy/mapping-schema.sql` de forma idempotente. O que falta: `index.ts` ainda bootstrapa só o monitor único de demo (env var fixa), não lê `monitored_accounts` do banco; `dashboard/server.ts` ainda usa as implementações em memória (`InMemoryUserRepository` etc.) pro login — unificar a identidade de login do painel com `phone_mappings.id` é decisão de design ainda não tomada, não só código faltando.
- **Cadastro (`PhoneMappingService.register`) existe mas não está exposto por HTTP**: a lógica de prova de propriedade + criptografia está completa e testada (`privacy/phone-mapping.ts`, `privacy/ownership-proof.ts`), e agora tem onde persistir (`PostgresPhoneMappingRepository.save`), mas nenhuma rota em `dashboard/server.ts` chama isso — hoje não tem como um usuário real se cadastrar pelo sistema.
- **`monitored_accounts` (tabela e repositório existem) ainda não tem endpoint pra escolher chain/token**: a tabela já suporta qualquer chain EVM-compatível conhecida (`known-chains.ts`) e qualquer token ERC-20/TIP-20 por usuário, mas falta a rota HTTP que valida a escolha (`getKnownChain`) e grava via `PostgresMonitoredAccountRepository.add`.
- **`TempoAdapter.classifyBalanceDelta` é um stub não conectado**: existe, mas (a) sempre retorna `"value-transfer"` (nunca filtra fee), e (b) `monitor.ts` nem chama essa função antes de `checkBalanceDrop` — ou seja, hoje uma dedução de fee de rotina (lembrando: Tempo não tem gas token nativo, a fee sai do mesmo TIP-20 monitorado) pode disparar falso positivo de "queda de saldo". Risco real de ruído na demo se o endereço observado fizer transações no meio da gravação.
- **Sem health-check do próprio monitor**: se o loop em `monitor.ts` parar de progredir (RPC fora do ar, erro não tratado), hoje só aparece no log local — nada avisa a equipe ativamente. A linha anterior deste documento afirmava que isso existia; não existe, corrigido aqui.
