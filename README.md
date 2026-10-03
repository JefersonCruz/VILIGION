# VILIGION

> Monitoramento de tesouraria on-chain para a blockchain Tempo, com alerta por ligação telefônica quando o dono não está olhando um dashboard — e proteção de privacidade desenhada contra ataques físicos ("wrench attacks").

Construído para o hackathon **Crypto World's Fair** (Colosseum), track **Tempo**.

## O problema

Donos de negócio que recebem/mantêm stablecoin em tesourarias on-chain na Tempo não têm uma forma de saber, em tempo real, quando algo sai do padrão — queda brusca de saldo, transferência bloqueada por política de recebimento, atividade fora do histórico — a menos que estejam olhando um dashboard o dia inteiro. Ferramentas de monitoramento existentes (Hexagate, Elliptic, TRM Labs, Blockaid) são construídas para times de segurança institucionais, não para o dono de uma PME sem esse time.

Ao mesmo tempo, vincular um número de telefone a um saldo on-chain cria um risco real e documentado: ataques físicos ligados à posse de cripto ("wrench attacks") cresceram mais de 33% ano a ano em 2026 (CertiK), com mais de US$30M roubados só no primeiro semestre (Chainalysis).

## O que este projeto faz

1. **Monitora** endereços TIP-20 na Tempo (saldo, eventos de `ReceivePolicyGuard`/TIP-403, padrão de transferência) via RPC direto (Viem) como fonte primária.
2. **Detecta** anomalias com limiares configuráveis por usuário (privados, não hardcoded).
3. **Alerta** por ligação telefônica real (Twilio Programmable Voice) com conteúdo **sempre genérico** — nunca revela saldo ou endereço por voz/SMS.
4. **Protege a identidade do dono**: número de telefone virtual dedicado (nunca o pessoal), vínculo telefone↔endereço armazenado criptografado via KMS gerenciado, prova de propriedade do endereço exigida no cadastro (assinatura EIP-191).
5. Detalhes completos (saldo real, histórico) só ficam visíveis após autenticação no painel — nunca pelo canal de alerta.

## O que este projeto **não** faz (por decisão de segurança, não por falta de tempo)

- Não executa transações a partir de resposta por voz/SMS. Qualquer ação de valor exige login completo + assinatura da própria carteira do usuário.
- Não é um produto de custódia. Nunca detemos chave privada do usuário.
- Não substitui ferramentas de segurança institucional (Hexagate, Elliptic, TRM) — é um complemento pensado para quem não tem time de segurança.

Ver [`SECURITY.md`](./SECURITY.md) para o modelo de ameaça completo.

## Como funciona (visão geral)

```
Motor de Detecção (core EVM + adaptador Tempo)
        │ evento de anomalia (sem dado sensível)
        ▼
Camada de Privacidade (resolve endereço→contato, decide o que pode sair)
        │ payload genérico
        ▼
Camada de Entrega (Twilio Voice)
        │
        ▼
Painel/Auth (detalhe completo só após login)
```

Detalhe técnico completo em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Status

Projeto em construção para o hackathon Crypto World's Fair (submissão até 13/10/2026). Ver [`GOVERNANCE.md`](./GOVERNANCE.md) para como decisões são tomadas nesta fase, e [`docs/BUSINESS-PLAN.md`](./docs/BUSINESS-PLAN.md) para o plano de negócio e desenvolvimento por fase.

## Licença

MIT — ver [`LICENSE`](./LICENSE).
