# Instruções para agentes de IA trabalhando neste repositório

Este arquivo segue a convenção aberta AGENTS.md (compatível com Claude Code, Codex, Cursor e outros agentes de codificação). Se seu agente usa `CLAUDE.md` especificamente, trate este arquivo como a fonte primária de instruções.

## Regras invioláveis (não editar sem aprovação humana explícita)

- Nunca escreva, logue, ou exponha chaves de API, credenciais Twilio, strings de conexão de banco, ou a chave de criptografia AES em qualquer arquivo rastreado pelo git.
- Nunca adicione um caminho de código que execute transação on-chain a partir de resposta de voz/SMS/WhatsApp. Essa decisão foi revertida deliberadamente após revisão de segurança — não reintroduza sem discussão explícita documentada.
- Nunca inclua saldo, endereço completo, ou valor monetário no conteúdo de uma mensagem/ligação de alerta (`/alerts`, `alert-content-policy.ts`). Teste automatizado deve falhar o build se isso for violado.
- Nunca hardcode limiares numéricos de detecção de usuário no código público (`/engine/rules`).

## Contexto do projeto

Veja `README.md` (objetivo), `ARCHITECTURE.md` (como funciona) e `SECURITY.md` (modelo de ameaça) antes de propor mudanças estruturais. Este projeto monitora endereços TIP-20 na blockchain Tempo e alerta donos de tesouraria por ligação telefônica, com proteções de privacidade desenhadas contra desanonimização e ataques físicos de coação.

## Ao adicionar suporte a uma nova chain EVM

Siga o padrão "núcleo + adaptador": lógica genérica em `chains/evm-adapter.ts`, qualquer regra específica de protocolo (ex: eventos customizados como o `ReceivePolicyGuard` da Tempo) em um adaptador próprio (`chains/<nome-da-chain>.adapter.ts`). Não assuma que uma regra de uma chain se aplica a outra sem verificar a documentação oficial dela.

## Antes de abrir PR

Rode os testes de `alert-content-policy` e `ownership-proof` — são os dois pontos onde uma regressão vira falha de segurança, não só bug funcional.
