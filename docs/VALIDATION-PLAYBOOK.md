# VILIGION — Roteiro de validação de demanda

Objetivo: em poucos dias, reunir **evidência real** de que alguém tem esse problema e pagaria (ou ao menos se comprometeria) por uma solução. O que vale na submissão são fatos que você consegue mostrar: quantas pessoas contatou, quantas responderam, o que disseram, quantas entraram na lista.

Regras que mantêm a evidência honesta:
- Registre **tudo** (data, perfil, resposta) em uma planilha. Sem número inventado.
- Interesse educado não é demanda. Conta mais: quem pergunta preço, pede para testar, indica outra pessoa ou aceita uma segunda conversa.
- Quem vai julgar lê isso como a *sua* voz. Reescreva os modelos abaixo com as suas palavras.

## 1. Quem contatar (por prioridade)

1. Tesoureiros, fundadores e contribuidores de **DAOs e startups cripto** que guardam stablecoins em carteira.
2. Quem **constrói ou opera na Tempo** (Discord, X, GitHub) e lida com pagamentos em stablecoin.
3. Pessoas com **carteira pessoal grande** que já falam de segurança física (comunidades cripto do Brasil e de fora).
4. Quem já foi alvo ou conhece alguém que foi (esta é a conversa mais valiosa, mesmo que não vire cliente).

Meta mínima sugerida: 30 contatos, 8 a 10 conversas, 3 pessoas dispostas a testar.

## 2. Mensagem de contato (modelo para adaptar)

> Oi, [nome]. Vi que você [contexto real: cuida da tesouraria da X / construiu Y na Tempo / falou sobre segurança de carteira].
>
> Estou construindo uma ferramenta que vigia o saldo de uma tesouraria em stablecoin e **liga para alguém de confiança** quando algo anormal acontece, sem mostrar saldo nem endereço no alerta. A ideia é cobrir o caso em que a pessoa que controla a chave está sob coação ou foi comprometida.
>
> Não estou vendendo nada ainda. Queria entender como você lida com isso hoje. Teria 15 minutos esta semana? Se preferir, respondo qualquer pergunta por texto.

Variação curta (para DM):

> Oi, [nome]. Estou pesquisando como times protegem tesouraria em stablecoin contra coação ou chave comprometida. Posso te fazer 3 perguntas rápidas? Em troca, te mostro o que construí.

Depois da conversa, se houver interesse: envie o link da lista de espera (a raiz do app) e peça para indicar uma pessoa.

## 3. Roteiro de entrevista (15 a 20 min)

Comece pelo passado e pelo concreto, não pela sua ideia. Só apresente o produto no final.

**Contexto**
1. Quanto e onde vocês guardam hoje? Quem tem acesso às chaves?
2. Quem decide movimentar fundos? Existe multisig, limite de saque ou aprovação dupla?

**Dor real**
3. Já houve um susto, tentativa de golpe ou transferência indevida? O que aconteceu?
4. Se alguém forçasse você a transferir, o que no seu processo impediria ou avisaria outra pessoa?
5. Como vocês ficariam sabendo de uma saída estranha de fundos, e em quanto tempo?

**Alternativas atuais**
6. Usam algo hoje para monitorar (Etherscan alerts, Forta, Tenderly, bots próprios, nada)? O que falta nisso?
7. Já pagou por segurança ou monitoramento? Quanto e por quê?

**Reação à ideia (mostre só agora)**
8. Explique em duas frases e peça a reação com as palavras dela. O que parece útil e o que parece estranho?
9. Quem seria a pessoa avisada no seu caso? Ela atenderia uma ligação às 3h da manhã?
10. Receber ligação e código por WhatsApp incomoda ou dá segurança?

**Compromisso (o sinal que importa)**
11. Se funcionasse como descrevi, você usaria na semana que vem? O que faltaria?
12. Quanto isso valeria por mês? Em que valor você acharia caro demais?
13. Posso te colocar na lista para testar primeiro? Conhece alguém que também deveria conversar comigo?

## 4. O que registrar após cada conversa

| Campo | Exemplo |
|---|---|
| Data / canal | 2026-10-08, call |
| Perfil | tesoureiro de DAO |
| Já teve incidente? | sim / não / conhece caso |
| Alternativa que usa hoje | multisig + nada de monitor |
| Reação | pediu para testar / indiferente / objeção X |
| Preço citado | US$ 20/mês |
| Próximo passo combinado | entrou na lista, indicou fulano |

## 5. Como transformar isso em evidência

- Números simples: contatos feitos, respostas, conversas, inscritos na lista (use `GET /admin/waitlist` com o token), pessoas que aceitaram testar.
- Duas ou três **frases literais** de entrevistados (com permissão para citar), principalmente sobre a dor e o preço.
- O que você aprendeu e **mudou** no produto por causa disso. Mostrar uma mudança de rumo vale mais que só confirmação.
- Se o resultado for fraco, diga isso e o que vai testar a seguir. Evidência honesta e fraca pesa mais que forte e vaga.

## 6. Perguntas para refletir antes de escrever a seção de validação do portal

- Qual é o menor grupo de pessoas para quem isso é urgente hoje, e como você chegou até elas?
- O que alguém fez (não disse) que prova interesse?
- Qual hipótese sua foi contrariada nas conversas?
- Qual é o plano para os próximos 30 dias depois do hackathon?

## 7. Operação da lista de espera

- Landing pública: raiz do app (`/`), formulário em `POST /waitlist`, limite de 5 inscrições por hora por IP.
- Exportar inscritos: `GET /admin/waitlist` com `Authorization: Bearer <WAITLIST_ADMIN_TOKEN>` (variável no Railway, serviço `viligion-app`). Sem a variável, a rota responde 404.
- Os e-mails ficam em texto puro na tabela `waitlist_signups`, de propósito (dado de marketing entregue pelo próprio visitante). Não misture com os destinatários de alerta, que são criptografados.
