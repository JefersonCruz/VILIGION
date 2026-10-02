# Governança

## Fase atual: pré-lançamento (hackathon)

Este projeto nasceu para o hackathon Crypto World's Fair da Colosseum. Nesta fase, decisões técnicas e de produto são tomadas pela equipe fundadora listada em [`CONTRIBUTING.md`](./CONTRIBUTING.md). Não há processo formal de votação ainda — não faria sentido simular governança que não existe de verdade apenas para parecer maduro.

## Objetivo declarado de evolução

Se o projeto continuar após o hackathon (especialmente se o decodificador TIP-403/`ReceivePolicyGuard` for adotado por outros builders do ecossistema Tempo), a intenção é migrar para:

1. **Issues e PRs abertos a qualquer contribuidor**, com critérios de aceite documentados em `CONTRIBUTING.md`.
2. **Decisões técnicas relevantes discutidas publicamente** (GitHub Discussions ou equivalente), não decididas em privado.
3. Avaliar formalização de um processo de revisão com mais de uma pessoa aprovando mudanças na camada de segurança/privacidade (`/privacy`, `/alerts`), dado o risco elevado dessas áreas.

## O que não muda independentemente da governança

As regras de `SECURITY.md` (nunca revelar saldo/endereço em alerta, nunca custodiar chave privada, nunca autorizar transação por resposta de voz/SMS) são tratadas como **invariantes do projeto**, não sujeitas a decisão de roadmap — mudar isso exigiria reescrever o modelo de ameaça inteiro, não é uma feature normal.

## Licenciamento

MIT. Qualquer fork ou uso comercial é permitido nos termos da licença; não há obrigação de contribuir de volta, mas é incentivada.
