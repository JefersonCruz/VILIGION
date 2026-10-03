# Governança

## Fase atual: pré-lançamento (hackathon)

Este projeto nasceu para o hackathon Crypto World's Fair da Colosseum. Nesta fase, decisões técnicas e de produto são tomadas pela equipe fundadora listada em [`CONTRIBUTING.md`](./CONTRIBUTING.md). Não há processo formal de votação ainda — não faria sentido simular governança que não existe de verdade apenas para parecer maduro.

## Objetivo declarado de evolução

Se o projeto continuar após o hackathon (especialmente se o decodificador TIP-403/`ReceivePolicyGuard` for adotado por outros builders do ecossistema Tempo), a intenção é migrar para:

1. **Issues e PRs abertos a qualquer contribuidor**, com critérios de aceite documentados em `CONTRIBUTING.md`.
2. **Decisões técnicas relevantes discutidas publicamente** (GitHub Discussions ou equivalente), não decididas em privado.
3. Avaliar formalização de um processo de revisão com mais de uma pessoa aprovando mudanças na camada de segurança/privacidade (`/privacy`, `/alerts`), dado o risco elevado dessas áreas.

## Papéis futuros (quando houver tração pra justificar, ver `docs/BUSINESS-PLAN.md`)

Dois papéis identificados a partir de lacunas reais da arquitetura (ver `ARCHITECTURE.md` → "Lacunas de arquitetura"), não genéricos — cada um tem dono de problema concreto:

**Agente de Pesquisa e Desenvolvimento (P&D)**
Responsabilidade: manter as premissas do projeto contra a Tempo em dia, formalizando o que foi feito manualmente nesta investigação (confirmar RPC/chain ID, endereço do `ReceivePolicyGuard`, ABI, e a descoberta de que `ox`/`viem/tempo` já cobre partes do protocolo) como processo recorrente, não evento único. A própria Tempo avisa que TIP-403 e a Indexer API "ainda estão evoluindo" — alguém precisa re-verificar isso periodicamente contra a documentação oficial e a rede real (`scripts/verify-testnet.ts` é o ponto de partida natural pra automatizar isso, ex: rodar como job agendado e alertar se algo não bater mais).

**Cientista de Dados**
Responsabilidade: calibrar os limiares de detecção com dado real em vez de constante chutada, e resolver a lacuna do `classifyBalanceDelta` (hoje stub, nunca filtra fee de valor real). Como a Tempo não tem gas token nativo, toda transação deduz fee do mesmo saldo monitorado — sem um modelo estatístico real de "qual é o tamanho típico de uma dedução de fee", o sistema não consegue diferenciar ruído operacional de anomalia de verdade. Primeira entrega concreta: coletar histórico de transações de endereços reais na Tempo e definir, com dado, o que é "tamanho de fee" vs. "saída de valor".

## O que não muda independentemente da governança

As regras de `SECURITY.md` (nunca revelar saldo/endereço em alerta, nunca custodiar chave privada, nunca autorizar transação por resposta de voz/SMS) são tratadas como **invariantes do projeto**, não sujeitas a decisão de roadmap — mudar isso exigiria reescrever o modelo de ameaça inteiro, não é uma feature normal.

## Licenciamento

MIT. Qualquer fork ou uso comercial é permitido nos termos da licença; não há obrigação de contribuir de volta, mas é incentivada.
