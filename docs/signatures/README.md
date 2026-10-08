# Assinaturas do Acordo de Colaborador

Um arquivo JSON por colaborador(a), nomeado `<login-do-github>.json`, registrando que essa pessoa concordou com o Acordo de Colaborador VILIGION numa versão específica. Fica em PR normal, versionado como qualquer outro arquivo — o histórico do git já é o log de auditoria, sem precisar de banco ou endpoint novo.

O acordo em si **não está neste repositório** (é documento privado, compartilhado por link individual — ver nota no topo do próprio documento) — só o registro de quem assinou, com qual pedido declarado, fica público aqui. Esse registro não revela nenhum percentual fixo do acordo, só o que a própria pessoa declarou pedir.

## Formato — assinatura por carteira (Método A, verificável por qualquer pessoa)

```json
{
  "githubLogin": "exemplo-login",
  "method": "wallet",
  "agreementVersion": "v2-2026-10-07",
  "agreementHash": "sha256-publicado-junto-do-link-privado",
  "address": "0x0000000000000000000000000000000000000000",
  "signature": "0x...",
  "prizeAsk": "ex: 20% do pool, ou 'a negociar'",
  "salaryAsk": "ex: R$ 6.000/mês se full-time, ou 'não aplicável'",
  "signedAt": "2026-10-07T00:00:00Z"
}
```

Verifique com:

```
npx tsx scripts/verify-contributor-signature.ts --login exemplo-login --address 0x... --signature 0x... --hash sha256-publicado-junto-do-link-privado --prize-ask "mesmo texto de prizeAsk" --salary-ask "mesmo texto de salaryAsk"
```

`--prize-ask`/`--salary-ask` precisam ser EXATAMENTE o texto declarado na hora de assinar (inclusive maiúsculas/pontuação) — qualquer diferença faz a verificação dar inválida, porque o pedido faz parte da própria mensagem assinada.

## Formato — confirmação por e-mail (Método B, registrado pelo fundador)

```json
{
  "githubLogin": "exemplo-login",
  "method": "email",
  "agreementVersion": "v2-2026-10-07",
  "confirmedVia": "email",
  "confirmedAt": "2026-10-07T00:00:00Z",
  "prizeAsk": "ex: 20% do pool, ou 'a negociar'",
  "salaryAsk": "ex: R$ 6.000/mês se full-time, ou 'não aplicável'",
  "note": "Confirmação recebida por e-mail em jefersonhenri1@gmail.com, assunto 'Acordo de Colaborador VILIGION - exemplo-login'."
}
```

Este método não é verificável de forma independente/criptográfica como o Método A — depende da palavra do fundador sobre ter recebido o e-mail (incluindo os pedidos declarados nele). Use o Método A quando possível.

## Por que não tem um arquivo de exemplo de verdade aqui

De propósito — um JSON de exemplo com endereço/assinatura fake poderia ser confundido com um registro real. Os dois blocos acima já mostram o formato completo; o primeiro PR de assinatura real serve de exemplo vivo pros próximos.
