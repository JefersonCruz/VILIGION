# Como contribuir

## Antes de tudo

Este projeto tem duas partes com regras diferentes:

1. **Biblioteca de decodificação TIP-403/`ReceivePolicyGuard`** (`/engine/chains/tempo.adapter.ts` e módulos relacionados) — contribuições bem-vindas de qualquer builder do ecossistema Tempo. Esta é a parte pensada para ser infraestrutura compartilhada.
2. **Produto de alerta/privacidade** (`/privacy`, `/alerts`, `/dashboard`) — mudanças aqui exigem entender o modelo de ameaça em [`SECURITY.md`](./SECURITY.md) antes de abrir PR. Qualquer mudança que toque autenticação, criptografia ou conteúdo de alerta precisa justificar explicitamente como preserva (ou melhora) cada item da tabela de mitigação.

## Regras gerais

- Nunca commite segredos, chaves, ou dados reais de usuário — nem em código, nem em exemplos, nem em testes.
- `.env.example` deve conter apenas nomes de variáveis, nunca valores reais.
- Limiares de detecção específicos de usuário nunca entram hardcoded no código público.
- PRs que tocam `/privacy` ou `/alerts` precisam de pelo menos uma revisão adicional antes de merge.

## Como rodar localmente

(preencher conforme o setup final: testnet Moderato da Tempo, conta Twilio trial, variáveis de ambiente necessárias)

## Reportar bugs vs. vulnerabilidades de segurança

Bug normal → issue pública. Vulnerabilidade de segurança → ver processo de divulgação responsável em [`SECURITY.md`](./SECURITY.md), nunca issue pública.
