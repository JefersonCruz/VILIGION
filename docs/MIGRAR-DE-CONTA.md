# Migrar o VILIGION para outra conta de hospedagem

Guia operacional para quem está com as credenciais na mão. Complementa o [`DEPLOYMENT.md`](./DEPLOYMENT.md), que cobre um deploy do zero mas **não** cobre domínio próprio, Cloudflare, nem levar o banco de um lugar para outro.

> **A ordem importa.** Um passo deste guia é irreversível se feito fora de ordem: a chave mestra de criptografia. Leia a seção 1 antes de criar qualquer coisa na conta nova.

---

## 0. O que existe hoje

| | |
|---|---|
| Serviço do app | `viligion-app` → `https://viligion.com` |
| Banco | `Postgres`, com volume (`postgres-volume`) |
| Domínio | `viligion.com`, registrado/gerido na **Cloudflare**, com **proxy ligado** |
| Schema | um único `.sql` idempotente, aplicado por `npm run migrate` |
| Infra como código | **não existe** — a conta nova é configurada à mão |

**Verificar se o proxy da Cloudflare está mesmo ligado:**

```powershell
nslookup viligion.com
```

Se os endereços forem da faixa da Cloudflare (`104.21.x.x`, `172.67.x.x`, `2606:4700::/32`), o proxy está ligado. Isso é **a favor** da migração: o mundo resolve para a Cloudflare, não para a Railway. Trocar de conta muda só o destino interno — ninguém de fora espera propagação de DNS.

Consequência menos óbvia do mesmo fato: com o app fora do ar, quem abre o site recebe um erro da Cloudflare (`522`/`523`), não "site não encontrado". O domínio parece vivo e o produto parece quebrado.

---

## 1. Primeiro, tirar o que não se regenera

Faça isto **com a conta velha ainda acessível**. Depois de suspensa, cancelada ou com o volume reciclado, não há recuperação.

### 1.1 A chave mestra de criptografia

A variável tem nome enganoso:

```
ENCRYPTION_KEY_KMS_ARN
```

Parece ponteiro para um recurso da AWS. **Não é.** O código a trata como a chave em si:

```ts
new MappingEncryption(new LocalDevKeyProvider(process.env.ENCRYPTION_KEY_KMS_ARN))
// LocalDevKeyProvider: Buffer.from(masterKeyHex, "hex")
```

Todo destinatário de alerta — telefone e e-mail, nas tabelas `phone_mappings`, `alert_recipients` e `waitlist_signups_enc` — está cifrado por envelope sob essa chave. Sem o valor exato, os registros continuam no banco e ficam **ilegíveis para sempre**.

O modo de falha é pior que perder o dado: o produto sobe, monitora, detecta a anomalia — e não tem para onde ligar. O painel diz protegido.

```powershell
# le e guarda em variavel de sessao, sem imprimir na tela
$chave = (railway variable list -s viligion-app --kv |
  Select-String "^ENCRYPTION_KEY_KMS_ARN=").ToString().Split("=",2)[1]

# confere o formato sem revelar o valor: 64 caracteres hex
$chave.Length                      # deve dar 64
$chave -match '^[0-9a-f]{64}$'     # deve dar True
```

Guarde num gerenciador de senhas, não num arquivo do projeto e não num chat.

> O nome da variável é um risco por si só: parece um identificador inofensivo, do tipo que se cola num ticket ou aparece num print de tela sem pensar. Renomear exige um deploy coordenado (o código lê esse nome), então fica registrado aqui como armadilha conhecida.

### 1.2 O dump do banco

O banco está **offline**. Precisa subir antes — resolver o crédito na conta velha é pré-requisito para migrar sem perder dado.

```powershell
# sobe o Postgres pelo painel da Railway, depois:
railway run -s Postgres -- pg_dump --format=custom --no-owner --no-privileges -f viligion.dump

# confere que o arquivo tem conteudo de verdade
(Get-Item viligion.dump).Length
```

Se `pg_dump` reclamar de versão de servidor, o `pg_dump` local é mais antigo que o Postgres da Railway. Use o `pg_dump` de uma versão igual ou maior — não force com `--no-sync` nem ignore o aviso.

### 1.3 O par VAPID

```
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
```

Não é segredo irrecuperável, mas **trocá-lo quebra em silêncio toda inscrição de push existente**: o aparelho não avisa, só para de receber. Para um canal de alerta, falha silenciosa é o pior tipo.

Decida de propósito: ou carrega o par igual, ou troca e avisa quem está inscrito que precisa se registrar de novo. Não decida por omissão.

---

## 2. Subir na conta nova

Siga o [`DEPLOYMENT.md`](./DEPLOYMENT.md) do Passo 1 ao 3 (projeto, Postgres, repositório conectado, app ligado ao banco). Não gere domínio público ainda.

---

## 3. Variáveis: o que copiar, o que rotacionar, o que deixar morrer

Defina tudo com `--stdin`, para o valor não entrar no histórico do shell:

```powershell
# le do teclado sem ecoar, e manda direto
$v = Read-Host -AsSecureString "valor"
[Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($v)) |
  railway variable set NOME_DA_VARIAVEL --stdin --skip-deploys
```

### Copiar idêntico

| Variável | Por quê |
|---|---|
| `ENCRYPTION_KEY_KMS_ARN` | sem ela o banco restaurado é ilegível. Rotacione **depois** (seção 6), nunca durante |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | trocar quebra push em silêncio (1.3) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_VOICE_NUMBER`, `TWILIO_WHATSAPP_NUMBER` | identificadores, não segredos |
| `TEMPO_RPC_URL`, `TEMPO_CHAIN_ID`, `DEMO_WATCHED_ADDRESS` | configuração de rede |
| `PUBLIC_BASE_URL` | `https://viligion.com` — o domínio não muda, então o webhook da Twilio **não precisa ser reconfigurado** |

### Rotacionar agora (ver seção 5)

| Variável | Por quê |
|---|---|
| `TWILIO_AUTH_TOKEN` | é o único que um terceiro usa **sem** o nosso app: dá para gastar crédito e ligar em nome da conta |
| `WAITLIST_ADMIN_TOKEN` | nosso, gerado por nós |

`DATABASE_URL` não é copiada nem rotacionada: a Railway a fornece ao ligar o app ao Postgres novo.

### **Não** levar

```
JUDGE_ACCESS_USERNAME
JUDGE_ACCESS_PASSWORD
```

O login de avaliação é de **um fator**. O julgamento terminou em 2026-10-13 e `JUDGE_ACCESS_EXPIRES_AT` é 2026-11-14. Não definir as duas na conta nova apaga o caminho sem precisar de commit — é o jeito mais limpo de encerrá-lo.

Enquanto o PR da correção da sessão de avaliação não estiver no `master`, subir com essas duas definidas reabre uma escalada conhecida (ver a seção de incidente no [`SECURITY.md`](../SECURITY.md)).

---

## 4. Restaurar o banco

```powershell
railway run -s Postgres -- psql -c "SELECT version();"      # confirma que conectou
railway run -s Postgres -- pg_restore --no-owner --no-privileges -d $env:DATABASE_URL viligion.dump

# o schema e idempotente: rodar depois do restore e seguro e fecha indices faltantes
npm run migrate
```

Confirme que o dado cifrado voltou **e abre com a chave**:

```powershell
railway run -s viligion-app -- npx tsx scripts/diagnose-push.ts
```

Esse script já valida a decifragem com a chave mestra. Se ele falhar aqui, pare: a chave não corresponde ao dump, e seguir adiante só adiciona dado novo sobre dado ilegível.

---

## 5. Cloudflare — trocar só a origem

Com o proxy ligado, o endereço público não muda. Mexe-se apenas no destino interno.

0. **Na conta VELHA, libere o domínio primeiro.** Um domínio próprio é único em toda a Railway: enquanto estiver preso ao serviço antigo, a conta nova não consegue reivindicá-lo, e o erro é genérico (`Failed to create custom domain, please try again`) — não diz que o motivo é esse. Verificado na prática: um subdomínio novo criou sem problema no mesmo instante em que o apex falhava, o que descarta limite de plano. Faça pelo **navegador**, logado na conta antiga: remover o domínio do serviço velho. Trocar o CLI de volta funciona também, mas custa duas trocas de sessão.

   Confira também o `www`: se estiver cadastrado no serviço antigo, precisa ser liberado junto.

1. **Na Railway (conta nova):** Settings → Networking → adicione `viligion.com` como domínio próprio. A Railway devolve **dois** registros, não um:

   | Tipo | Nome | Valor |
   |---|---|---|
   | CNAME | `@` (ou o subdomínio) | `<id>.up.railway.app` |
   | TXT | `_railway-verify` | `railway-verify=<token>` |

   O TXT é obrigatório para a verificação de propriedade; só o CNAME não basta. O alvo do CNAME é **por domínio** — não reaproveite o que aparece no domínio gerado nem o de outro domínio próprio.

2. **Na Cloudflare:** DNS → crie os dois registros acima. No apex o CNAME funciona por *CNAME flattening*.
3. **Durante a emissão do certificado**, deixe o registro em **DNS only** (nuvem cinza). Com o proxy ligado, o desafio de validação é interceptado pela Cloudflare e a emissão pode travar.
4. Quando a Railway marcar o certificado como emitido, volte para **Proxied** (nuvem laranja).
5. **SSL/TLS → modo de criptografia: `Full (strict)`.** A Railway serve certificado válido. Em `Flexible` a Cloudflare fala HTTP com a origem, a aplicação redireciona para HTTPS, e o resultado é laço de redirecionamento — o sintoma clássico de "o site não abre e não diz por quê".

Durante a troca, pode valer desligar o cache da Cloudflare para este host, para não servir página velha enquanto a origem muda.

---

## 6. Rotacionar a chave mestra — só com o banco no ar

Agora, não antes. O script precisa do banco para reabrir e re-empacotar cada DEK.

```powershell
$env:ROTATE_OLD_KEY = <a chave que você guardou na seção 1.1>
$env:ROTATE_NEW_KEY = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

railway run -s viligion-app -- npx tsx scripts/rotate-encryption-key.ts --dry-run   # simula
railway run -s viligion-app -- npx tsx scripts/rotate-encryption-key.ts            # executa

# grava a nova como a chave do app, e só então limpa a sessão
$env:ROTATE_NEW_KEY | railway variable set ENCRYPTION_KEY_KMS_ARN --stdin -s viligion-app
Remove-Item Env:ROTATE_OLD_KEY, Env:ROTATE_NEW_KEY
```

A rotação é barata porque a cifragem é por envelope: ela reabre a DEK de cada registro com a chave velha e a fecha com a nova, gravando só a coluna `encrypted_data_key`. O `ciphertext` não é tocado, e nenhum telefone ou e-mail em claro passa pelo processo.

**Guarde a chave velha até confirmar que o app funciona com a nova.** Depois disso, descarte-a.

---

## 7. Verificar que é vigilância, não fachada

Não basta o site abrir.

```powershell
railway logs -s viligion-app | Select-String "monitor"
```

Procure ciclos concluindo. A faixa de monitoramento do painel mostra o último ciclo com horário — é ela que distingue um monitor saudável de um travado no meio de um tick.

Depois, confirme pelo painel que os destinatários de alerta aparecem **cadastrados e legíveis**. Se a lista voltou vazia, a decifragem falhou em silêncio: o produto está vigiando sem ter para onde avisar, que é o estado que este guia existe para evitar.

---

## 8. O que mudar de conta **não** resolve

- **Os segredos que já vazaram continuam vazados.** Em 2026-10-22 a Railway notificou que um terceiro pode ter lido variáveis de ambiente de clientes, incluindo conteúdo descriptografado. O remédio é a rotação (seções 3 e 6), não o endereço da conta. Rotacionar fecha a porta para frente; não apaga o que já saiu.
- **A chave mestra continua numa variável de ambiente.** É a lacuna conhecida da issue #9: um vazamento só do banco rende texto cifrado, mas quem lê o ambiente do app leva a chave. Um KMS gerenciado é a correção; conta nova não é.
- **Criar conta nova para renovar crédito gratuito é motivo de suspensão** na maioria dos provedores. Para um produto cuja função é ligar para o dono quando a tesouraria está sendo drenada, ficar pendurado numa conta que pode ser desligada sem aviso é risco operacional, não economia.
