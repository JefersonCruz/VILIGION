# Rascunhos de divulgação open source

**Nada aqui foi publicado.** São rascunhos para revisão humana antes de qualquer publicação, em qualquer canal. Preparados em 2026-10-12.

## Regras que todos os textos abaixo seguem

Escritas aqui para que uma revisão futura (ou um reescrita) não as perca:

1. **Nenhuma afirmação de suporte sem evidência.** O projeto tem adaptador EVM genérico testado e a Tempo verificada contra a testnet Moderato. Não tem Base, Arbitrum ou Ethereum validados contra rede real, e não tem Solana. Nenhum texto diz "suporta N redes".
2. **Nenhuma auditoria alegada.** Não houve auditoria de segurança externa.
3. **Nenhuma promessa de remuneração, participação societária, token, airdrop ou premiação.** Contribuição é contribuição.
4. **Convite para construir, não pedido de estrela.** Nenhum texto pede star, retweet ou "apoio".
5. **Nada que prometa tempo de resposta** que o projeto (hoje uma pessoa) não possa cumprir.
6. **Nenhuma credencial, endereço real ou dado de usuário.**

---

## 1. Post de apresentação (X)

> Tesouraria onchain hoje é monitorada por ferramenta feita pra analista de segurança: dashboard que alguém precisa estar olhando.
>
> VILIGION inverte isso. Detecta o evento, liga pro dono no telefone, e nunca diz saldo nem endereço na ligação — porque a operadora guarda registro de chamada e a gente não controla isso.
>
> Open source, MIT. O que existe de verdade hoje: motor de detecção genérico pra EVM, adaptador da Tempo verificado contra a testnet Moderato (TIP-403, decodificação de recibo de bloqueio, classificação de taxa), alerta por ligação e por Web Push.
>
> O que não existe: nenhuma rede marcada como estável, nenhuma auditoria externa. Tá tudo numa matriz de compatibilidade no repo, com o que foi testado e o que não foi.
>
> github.com/JefersonCruz/VILIGION

**Nota para revisão:** verificar o link e se "testnet Moderato" é a descrição corrente antes de publicar.

---

## 2. Post técnico — a arquitetura extensível (thread no X)

> 1/ Passei essa semana preparando o VILIGION pra receber contribuição de rede sem eu no meio. O trabalho não foi adicionar blockchains — foi tirar os acoplamentos que impediam qualquer pessoa de adicionar uma.

> 2/ Achado mais incômodo da auditoria: `known-chains.ts` tinha um campo `hasTempoStyleExtensions` que produção nunca lia. Só aparecia em asserção de teste. Quem decidia de verdade era um `if (chainKey === "tempo")` no entrypoint.
>
> Rede "registrada" assim não é rede suportada.

> 3/ O `Monitor` recebia a classe concreta `EvmAdapter` no construtor. Enquanto toda rede era EVM isso não doía. Mas significa que integrar Solana exigiria editar o núcleo — justamente o arquivo que um colaborador externo não deveria ter que tocar.

> 4/ E a camada de regras genéricas importava `TransferBlockedEvent` do adaptador da Tempo. Regra comum a todas as redes dependendo, em tempo de compilação, do módulo de uma rede só.
>
> Qualquer outra rede teria que imitar o formato da Tempo (errado, a semântica é diferente) ou editar o núcleo (errado, é o núcleo).

> 5/ O contrato novo é propositalmente mínimo: 3 métodos, os que o monitor de fato chama por ciclo. Mais metadados, capacidades declaradas e o limite de janela de histórico.
>
> Não assume que a rede tem bloco, log, ERC-20 ou moeda nativa. O cursor é opaco: bloco no EVM, slot em Solana.

> 6/ A parte de que mais gostei: `ChainCapabilities`. Declarar `false` é resposta legítima.
>
> O que isso evita é específico: um adaptador devolver `0n` de um saldo que não sabe ler. O núcleo trata "não observei" como "não houve movimento". O painel diz protegido. Não está.

> 7/ A Tempo declara `nativeBalance: false`. `eth_getBalance` responde na rede real — mas a Tempo não tem gas token nativo, então o número não tem relação com o saldo TIP-20 da tesouraria. Capacidade que responde com valor irrelevante é pior que capacidade ausente.

> 8/ Escrever os testes de evento duplicado achou um bug de verdade. Quando a extensão devolve vários eventos num intervalo e a entrega de um falha, o cursor não avança (correto — senão o evento se perde). Mas o ciclo seguinte reentrega os que já foram.
>
> Medido: 1 bloqueio → 5 alertas. 5 ligações.

> 9/ Corrigido com um conjunto limitado de chaves já entregues, marcadas **depois** da entrega bem-sucedida. Marcar antes transformaria falha de entrega em evento descartado em silêncio — o modo de falha oposto e pior.

> 10/ A prova de que o contrato não ficou com forma de EVM é um teste: um adaptador não-EVM de mentira, baseado em slot, que não herda de nada e não conhece ABI, rodando no mesmo `Monitor` sem alteração.
>
> Se o contrato fosse EVM-shaped, aquele arquivo não compilaria.

> 11/ 248 → 358 testes. A suíte de conformidade é reutilizável: um adaptador novo declara um subject e ganha a bateria inteira, incluindo o teste que mais importa — o que prova que falha de RPC propaga em vez de virar saldo falso.

> 12/ Contrato: docs/ADAPTER_SPEC.md
> Tutorial: docs/DEVELOPING_ADAPTERS.md
> O que de fato está suportado: docs/CHAIN-SUPPORT-MATRIX.md
>
> Nenhuma rede está estável. Isso é uma afirmação sobre evidência, não modéstia.

**Nota para revisão:** o número de testes (248 → 358) e a contagem de 5 alertas são medidos e corretos em 2026-10-12. Reconferir se houver mudança antes de publicar.

---

## 3. Chamada para desenvolvedores de Solana e EVM

Para publicar como post, ou como seção no README/site.

> ### Procuramos quem conheça uma rede melhor do que a gente
>
> O VILIGION monitora tesouraria onchain e avisa o dono por ligação telefônica quando algo acontece. O motor é genérico; o que falta é rede.
>
> **O que já está pronto pra você:** um contrato de integração documentado, uma suíte de testes de conformidade que seu adaptador roda de graça, e um adaptador de referência (Tempo) que mostra como conter a particularidade de um protocolo sem espalhá-la pelo núcleo. Adicionar uma rede é um módulo novo mais uma linha de tabela — não é mexer no caminho crítico de todo mundo.
>
> **Se você trabalha com EVM:** Base, Arbitrum e Ethereum L1 já estão registradas e rodam no adaptador genérico, mas estão marcadas como **experimentais** porque ninguém nunca exercitou nenhuma delas contra a rede real. Fechar essa lacuna numa delas — conferir leitura de saldo de um endereço conhecido, justificar a profundidade de confirmação pra aquela chain, documentar o que observou — é uma primeira contribuição pequena, útil e com escopo claro.
>
> **Se você trabalha com Solana:** é a integração que mais queremos, e a que vai testar de verdade se o contrato é agnóstico de rede. Não dá pra reaproveitar o adaptador EVM: não tem `eth_getLogs`, o cursor é slot e não bloco, saldo de token SPL mora numa token account que não mapeia em `balanceOf`, e a finalidade tem níveis. O histórico de eventos normalmente pede indexer, o que conflita com a decisão de manter terceiros fora do caminho crítico do alerta — e resolver essa tensão é parte interessante do trabalho.
>
> Escolhemos Solana justamente por ser longe o bastante do EVM pra expor onde o contrato está errado. Uma quinta chain EVM não exporia nada.
>
> **Duas regras que não negociamos**, as duas verificadas pela suíte: adaptador é somente leitura (nenhuma chave privada, nenhum signer, nenhum caminho de escrita) e falha de rede tem que propagar, nunca virar `0n`. Um monitor que parece saudável e não vê nada é o pior modo de falha que este produto tem.
>
> **O que a gente não promete:** remuneração, participação, token ou premiação por contribuição. Nem prazo de resposta — hoje o projeto é uma pessoa, e prometer SLA que não dá pra cumprir seria o primeiro jeito de perder a sua confiança. O que dá pra prometer é documentação suficiente pra você não depender de mim pra começar, e revisão honesta quando o PR chegar.
>
> Por onde começar: `docs/DEVELOPING_ADAPTERS.md`. Pra discutir antes de escrever código, abra uma issue com o template "Suporte a uma nova rede".

---

## 4. Issue pública convidando a primeira integração independente

Para abrir como issue no repositório. **Requer autorização antes de publicar.**

**Título:** `[rede] Primeira integração comunitária: adaptador de Solana`

**Labels:** `new-chain`, `zona-1-engine`, `help wanted`

**Corpo:**

> ## O que é
>
> Implementar um `MonitoredChainAdapter` para Solana — a primeira integração de rede escrita por alguém de fora do projeto.
>
> O objetivo desta issue é duplo, e o segundo importa mais que o primeiro: além do adaptador em si, ela é o teste de se a arquitetura de fato permite que uma pessoa desenvolva e valide uma rede com autonomia. Se você travar em algo que a documentação não cobre, **isso é o resultado mais valioso que esta issue pode produzir** — comente aqui em vez de contornar.
>
> ## Por que Solana, e não mais uma chain EVM
>
> Porque Solana é longe o bastante do EVM pra expor onde o contrato está errado. Uma quinta chain EVM rodaria no adaptador genérico e não provaria nada sobre extensibilidade.
>
> **Não presuma que o adaptador EVM é reaproveitável.** As diferenças que já identificamos (a lista não é exaustiva):
>
> - Não existe `eth_getLogs`
> - O cursor é slot, não bloco — o contrato já trata o cursor como valor opaco por isso
> - Saldo não mora em contrato: saldo de token SPL fica numa token account separada, que não mapeia em `balanceOf`
> - Finalidade tem níveis (`processed` / `confirmed` / `finalized`), não uma profundidade de confirmação única
> - Acesso a histórico de eventos geralmente exige indexer, o que conflita com a decisão de manter terceiros fora do caminho crítico do alerta (ver `ARCHITECTURE.md`). **Essa tensão é uma decisão de design em aberto**, não um requisito já resolvido — e discutir isso aqui antes de codificar provavelmente economiza seu tempo.
>
> ## Por onde começar
>
> 1. [`docs/DEVELOPING_ADAPTERS.md`](../blob/master/docs/DEVELOPING_ADAPTERS.md) — passo a passo
> 2. [`docs/ADAPTER_SPEC.md`](../blob/master/docs/ADAPTER_SPEC.md) — o contrato e o porquê de cada regra
> 3. `src/engine/chains/adapter-conformance.test.ts` → `FakeSlotChainAdapter` — um adaptador não-EVM completo, baseado em slot. É fixture de teste, mas é exatamente a forma que o seu vai ter.
>
> ## Pronto
>
> - [ ] `MonitoredChainAdapter` implementado, sem herdar de `EvmAdapter`
> - [ ] Passa `describeAdapterConformance`, incluindo o `createFailing()` obrigatório
> - [ ] Testes próprios de decodificação, determinísticos e offline
> - [ ] `capabilities` reflete o que Solana de fato permite observar — o que não dá, declarado `false`
> - [ ] Linha em `chain-registry.ts`, começando em `supportStatus: "experimental"`
> - [ ] Linha em `docs/CHAIN-SUPPORT-MATRIX.md`, com limitações preenchidas
> - [ ] Script de verificação contra devnet/testnet pública em `scripts/`, sem credencial pessoal
> - [ ] Núcleo intocado — ou, se não deu, um comentário aqui explicando o que o contrato não cobria
>
> ## Escopo
>
> Leitura de saldo + conformidade já é uma contribuição completa e vale merge. Eventos de protocolo e classificação de taxa podem vir em PRs separados.
>
> Comece em `experimental`. É a descrição correta de código que nunca tocou a rede real, não um demérito.
>
> ## Combinados
>
> - Diga aqui se você vai pegar, pra ninguém duplicar trabalho.
> - **Não há remuneração, participação, token ou premiação** por esta contribuição. É contribuição open source sob MIT.
> - Não prometo prazo de resposta — hoje o projeto é uma pessoa. Prometo revisão honesta e documentação suficiente pra você não depender de mim pra começar.
> - Mantenedor declarado é bem-vindo mas não obrigatório. "Contribuição pontual" é resposta aceita, e afeta só o status de maturidade que a integração pode alcançar.

---

## 5. Seção de contribuição para o site (viligion.com)

**Não aplicada.** O repositório contém `preview-landing.html`, mas não foi verificado se é o que está publicado em viligion.com nem como o site é implantado. Alterar produção precisa de autorização e de conferir o pipeline de deploy real.

Texto proposto, para quando isso for decidido:

> ### Construa o VILIGION junto
>
> Open source, MIT. O motor de detecção é genérico; o que falta é rede — e é aí que dá pra ajudar.
>
> Existe um contrato de integração documentado, uma suíte de testes que seu adaptador roda de graça, e um adaptador de referência pronto pra copiar. Adicionar uma rede não exige mexer no núcleo.
>
> Hoje: Tempo verificada contra testnet; Base, Arbitrum e Ethereum L1 registradas e marcadas como experimentais, porque ninguém as exercitou contra a rede real ainda. Nenhuma rede está estável, e nenhuma auditoria externa foi feita — a matriz de compatibilidade no repositório diz exatamente o que foi testado e o que não foi.
>
> Contribuição não gera remuneração, participação societária nem premiação. Gera código que protege tesouraria de outras pessoas.
>
> [Como contribuir →](https://github.com/JefersonCruz/VILIGION/blob/master/CONTRIBUTING.md)

---

## Checklist antes de publicar qualquer um destes

- [ ] Reconferir toda afirmação factual contra o estado atual do repositório (contagem de testes, status das redes, o que foi verificado)
- [ ] Confirmar que nenhum texto afirma suporte de produção a rede sem evidência
- [ ] Confirmar que nenhum texto menciona auditoria
- [ ] Confirmar que nenhum texto promete dinheiro, participação, token ou prazo de resposta
- [ ] Conferir os links
- [ ] Criar os labels do GitHub citados (`new-chain`, `new-detector`, `good first issue`, `documentation`, `security`) **antes** de abrir a issue — template que referencia label inexistente falha na aplicação
