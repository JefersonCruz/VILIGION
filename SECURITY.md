# Modelo de Ameaça e Política de Segurança

## Por que este documento existe

Este projeto lida com dados que, se vazados ou mal desenhados, podem expor usuários a risco financeiro **e físico** (ataques de coação ligados à posse de cripto — "wrench attacks"). Tratamos isso como requisito de design, não como item de checklist.

## Modelo de ameaça

| Ameaça | Mitigação |
|---|---|
| Vazamento do banco de dados expõe vínculo telefone↔endereço | Vínculo armazenado criptografado (AES); chave em KMS gerenciado, nunca no mesmo ambiente do banco |
| SIM swap / interceptação da linha telefônica | Conteúdo do alerta nunca revela saldo/endereço; ação sensível nunca é autorizada só por PIN de voz/SMS |
| Alguém cadastra o endereço público de outra pessoa com o próprio telefone | Exigida assinatura (`signMessage`) provando controle do endereço no cadastro |
| Forjar confirmação de PIN via webhook | Validação obrigatória de `X-Twilio-Signature` em todo endpoint que recebe resposta |
| TDoS (inundar a linha de alerta durante um ataque real) | Múltiplos canais e múltiplos destinatários configuráveis; sem dependência de uma única linha |
| Conta Twilio comprometida (vishing, smishing — já aconteceu à própria Twilio em 2022 e 2024) | Escopo mínimo de permissões da conta, rotação de API keys, PIN sempre de uso único atrelado a alerta específico |
| Retenção de registro de chamada (CDR) na operadora expõe que um número é cliente VILIGION — mesmo sem invasão de conta. Confirmado: Twilio retém From/To por 13 meses (Console/API) e indefinidamente via Bulk Export; no Brasil, ANATEL (Resolução 426/05) exige retenção mínima de 5 anos por qualquer operadora, independente de fornecedor — **não é específico da Twilio, é regulatório** | Não revela saldo/endereço (só a existência do relacionamento). Mitigado por escopo: ligação é reservada à severidade **critical** (ver `detection-rules.ts`/`ARCHITECTURE.md`) — reduz o volume de chamadas, não elimina a exposição residual. Aceito como limitação documentada, mesmo padrão de "obscurecido, não secreto" usado pros limiares de detecção |
| Ataque físico de coação ao dono ("wrench attack") | Múltiplos destinatários possíveis; nenhuma informação de valor exposta no canal de voz, reduzindo o incentivo de forçar o dono a atender |
| Painel web como alvo mais fácil que o canal de voz | MFA + rate-limiting no login, paridade de proteção com a camada de voz |

## O que nunca fazemos

- Não custodiamos chave privada do usuário.
- Não executamos transação a partir de resposta por voz/SMS.
- Não revelamos saldo ou endereço no conteúdo de um alerta.
- Não guardamos credenciais em texto puro no repositório ou no mesmo ambiente dos dados que protegem.

## Limitações conhecidas

Limiares de detecção são "obscurecidos, não secretos" — um atacante com paciência pode sondar empiricamente os limites com transferências de teste. Isso é uma limitação aceita e documentada, não uma garantia de impossibilidade de evasão.

## Divulgação responsável

Encontrou uma falha de segurança? Abra uma issue privada (GitHub Security Advisory) ou contate [email a definir]. Não abra issue pública para vulnerabilidades não corrigidas.
