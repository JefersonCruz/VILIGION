/**
 * Verificação manual de uma rede EVM registrada contra a rede DE VERDADE.
 *
 *   npx tsx scripts/verify-chain.ts --chain base
 *   npx tsx scripts/verify-chain.ts --chain ethereum --address 0x... --token 0x...
 *   npx tsx scripts/verify-chain.ts --chain base --rpc https://meu-rpc-dedicado
 *
 * Por que isto existe: `docs/CHAIN-SUPPORT-MATRIX.md` diz que Base, Arbitrum e
 * Ethereum L1 estão `experimental` porque NINGUÉM as exercitou contra a rede
 * real. Até hoje o projeto só tinha `verify-testnet.ts`, que é específico da
 * Tempo - então fechar essa lacuna em qualquer outra rede exigia escrever um
 * script novo do zero. Este serve para todas de uma vez, e é o mesmo que uma
 * pessoa de fora roda ao integrar a sua (ver docs/DEVELOPING_ADAPTERS.md).
 *
 * O que ele NÃO é: teste automatizado. Toca a rede real, depende de um RPC
 * público estar de pé, e por isso fica em `scripts/` e nunca em `npm test` -
 * a suíte precisa continuar passando num clone limpo, sem rede e sem
 * credencial (regra do ADAPTER_SPEC §5).
 *
 * O que ele NÃO prova: que a rede está pronta para produção. Ele confirma que
 * as premissas do adaptador batem com a rede num dado momento. Promover de
 * `experimental` para `validating` exige isto MAIS a decisão sobre
 * profundidade de confirmação (ver `confirmationJustified` em
 * chain-registry.ts) MAIS a linha na matriz.
 */

import { createPublicClient, http, isAddress, type Address } from "viem";
import { buildChainIntegration, getChainIntegration } from "../src/engine/chains/chain-registry.js";
import { getKnownChain, resolveRpcUrl, KNOWN_CHAINS } from "../src/engine/chains/known-chains.js";
import { MAX_LOG_RANGE_BLOCKS } from "../src/engine/chains/evm-adapter.js";

/** Endereço público sem relação com ninguém - só para exercitar a leitura de saldo. */
const ENDERECO_PADRAO = "0x000000000000000000000000000000000000dEaD" as Address;

interface Args {
  chain: string;
  address: Address;
  token?: Address;
  rpc?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (nome: string): string | undefined => {
    const i = argv.indexOf(`--${nome}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const chain = get("chain");
  if (!chain) {
    console.error("Uso: npx tsx scripts/verify-chain.ts --chain <rede> [--address 0x..] [--token 0x..] [--rpc url]");
    console.error(`Redes registradas: ${Object.keys(KNOWN_CHAINS).join(", ")}`);
    process.exit(2);
  }
  const address = (get("address") ?? ENDERECO_PADRAO) as Address;
  const token = get("token") as Address | undefined;
  if (!isAddress(address)) {
    console.error(`--address inválido: ${address}`);
    process.exit(2);
  }
  if (token && !isAddress(token)) {
    console.error(`--token inválido: ${token}`);
    process.exit(2);
  }
  return { chain, address, token, rpc: get("rpc") };
}

/**
 * Peso de cada verificação.
 *
 * A distinção existe porque a primeira execução real (Base, 16/10) produziu
 * um resumo enganoso: a paginação de logs falhou e o script declarou a rede
 * inteira reprovada. Mas o monitor de uma chain EVM genérica NUNCA chama
 * logs - `tick` só pede saldo, e `getConfirmedLogs` roda apenas quando há
 * extensão de protocolo, que só a Tempo tem. O monitoramento estava
 * funcionando; o resumo é que dizia o contrário.
 *
 * - `monitoramento`: o produto não funciona nesta rede sem isto.
 * - `capacidade`: uma capacidade DECLARADA não se confirma. Não impede
 *   monitorar hoje, mas a declaração precisa virar limitação registrada - e
 *   impede qualquer extensão futura.
 */
type Peso = "monitoramento" | "capacidade";

const resultados: Array<{ nome: string; ok: boolean; peso: Peso; detalhe: string }> = [];

function registra(nome: string, ok: boolean, peso: Peso, detalhe: string): void {
  resultados.push({ nome, ok, peso, detalhe });
  console.log(`${ok ? "✅" : "❌"} ${detalhe}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const integration = getChainIntegration(args.chain);
  const known = getKnownChain(args.chain);
  const rpcUrl = resolveRpcUrl(args.chain, args.rpc);

  console.log(`\n=== Verificando "${integration.displayName}" contra a rede real ===`);
  console.log(`Status declarado hoje : ${integration.supportStatus}`);
  console.log(`Mantenedor            : ${integration.maintainer ?? "(nenhum declarado)"}`);
  console.log(`RPC                   : ${rpcUrl}`);
  console.log(`Endereço observado    : ${args.address}`);
  console.log(`Token                 : ${args.token ?? "(nenhum - lerá saldo nativo)"}\n`);

  if (integration.family !== "evm") {
    console.error(`Este script só serve para redes da família "evm". "${args.chain}" é "${integration.family}".`);
    console.error("Uma rede de outra família precisa do seu próprio script - ver docs/DEVELOPING_ADAPTERS.md.");
    process.exit(2);
  }

  const client = createPublicClient({ transport: http(rpcUrl) });

  // --- 1. O RPC responde? ---
  console.log("=== 1. Conectividade ===");
  let blocoAtual: bigint;
  try {
    blocoAtual = await client.getBlockNumber();
    registra("rpc", true, "monitoramento", `RPC respondeu. Bloco atual: ${blocoAtual}`);
  } catch (err) {
    registra("rpc", false, "monitoramento", `RPC não respondeu: ${descreve(err)}`);
    return resumo(integration.supportStatus);
  }

  // --- 2. O chainId do RPC bate com o que o registro declara? ---
  //
  // A verificação mais importante das fáceis: um RPC apontando para a rede
  // errada devolve saldos e logs perfeitamente válidos, só que de OUTRA
  // blockchain. Nada mais abaixo falharia, e o monitor vigiaria a cadeia
  // errada em silêncio.
  console.log("\n=== 2. Identidade da rede ===");
  try {
    const idReal = await client.getChainId();
    const bate = idReal === known.chainId;
    registra(
      "chainId",
      bate,
      "monitoramento",
      bate
        ? `chainId confere: ${idReal} (registro e rede concordam)`
        : `chainId DIVERGE: registro diz ${known.chainId}, o RPC respondeu ${idReal} - este RPC é de outra rede`,
    );
  } catch (err) {
    registra("chainId", false, "monitoramento", `não foi possível ler o chainId: ${descreve(err)}`);
  }

  // --- 3. Leitura de saldo pelo adaptador de verdade ---
  //
  // Pelo adaptador montado pelo REGISTRO, não por uma chamada solta: é o
  // caminho que a produção usa, com a profundidade de confirmação declarada
  // pela rede. Testar outra coisa não provaria nada sobre o produto.
  console.log("\n=== 3. Leitura de saldo (pelo adaptador do registro) ===");
  const { adapter } = buildChainIntegration({
    chainKey: args.chain,
    tokenAddress: args.token,
    rpcUrlOverride: args.rpc,
  });

  console.log(`Capacidades declaradas: ${JSON.stringify(adapter.capabilities)}`);
  try {
    const snapshot = await adapter.getBalance(args.address);
    registra(
      "saldo",
      true,
      "monitoramento",
      `saldo lido: ${snapshot.raw} (unidade mínima), no bloco ${snapshot.blockNumber}`,
    );
    if (snapshot.raw === 0n) {
      console.log(
        "   ⚠️  Zero é um saldo legítimo. Para que esta verificação signifique algo, " +
          "rode de novo com --address de um endereço que você SABE que tem saldo.",
      );
    }
  } catch (err) {
    registra("saldo", false, "monitoramento", `leitura de saldo falhou: ${descreve(err)}`);
  }

  // --- 4. Profundidade de confirmação ---
  console.log("\n=== 4. Profundidade de confirmação ===");
  try {
    const confirmado = await adapter.getConfirmedBlockNumber();
    const atraso = blocoAtual - confirmado;
    registra(
      "confirmacao",
      atraso >= 0n,
      "monitoramento",
      `bloco confirmado ${confirmado}, ${atraso} atrás do topo (declarado: ${integration.defaultMinConfirmations})`,
    );
    if (!integration.confirmationJustified) {
      console.log(`   ⚠️  Esta profundidade NÃO foi justificada para esta rede.`);
      console.log(`   ${integration.confirmationRationale}`);
    }
  } catch (err) {
    registra("confirmacao", false, "monitoramento", `getConfirmedBlockNumber falhou: ${descreve(err)}`);
  }

  // --- 5. Paginação de logs ---
  //
  // Pede de propósito um intervalo MAIOR que o limite por chamada, pra provar
  // que a paginação interna funciona contra o provedor real - era o bug de
  // produção da issue #8, e é o que quebra primeiro num RPC novo.
  console.log("\n=== 5. Paginação de logs (intervalo maior que o limite por chamada) ===");
  const alvo = args.token ?? args.address;
  const janela = MAX_LOG_RANGE_BLOCKS + 1_000n;
  const desde = blocoAtual > janela ? blocoAtual - janela : 0n;
  try {
    const logs = await adapter.getConfirmedLogs({ address: alvo, fromBlock: desde });
    registra(
      "paginacao",
      true,
      "capacidade",
      `getConfirmedLogs cobriu ${janela} blocos sem erro (${logs.length} logs em ${alvo})`,
    );
    if (logs.length === 0) {
      console.log("   (Zero logs é normal se o endereço observado não emite eventos — não é falha.)");
    }
  } catch (err) {
    registra("paginacao", false, "capacidade", `paginação falhou: ${descreve(err)}`);
  }

  // --- 6. Marcos de finalidade da propria rede ---
  //
  // O dado que falta pra decidir `minConfirmations` com base em algo. As
  // chains EVM expoem `safe` e `finalized`; comparar com `latest` mostra
  // quanto a profundidade declarada realmente protege - em vez de herdar um
  // numero e torcer.
  console.log("\n=== 6. Marcos de finalidade (latest / safe / finalized) ===");
  try {
    const [latest, safe, finalized] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.getBlock({ blockTag: "safe" }).catch(() => null),
      client.getBlock({ blockTag: "finalized" }).catch(() => null),
    ]);
    const relata = (nome: string, b: { number: bigint | null; timestamp: bigint } | null): void => {
      if (!b || b.number === null) {
        console.log(`   ${nome}: nao exposto por este RPC`);
        return;
      }
      const blocos = latest.number === null ? 0n : latest.number - b.number;
      const seg = latest.timestamp - b.timestamp;
      console.log(`   ${nome}: ${blocos} blocos atras (${seg}s)`);
    };
    relata("safe     ", safe);
    relata("finalized", finalized);

    const d = BigInt(integration.defaultMinConfirmations);
    if (safe?.number != null && latest.number != null) {
      const ateSafe = latest.number - safe.number;
      const raso = ateSafe > d;
      registra(
        "finalidade",
        !raso,
        "capacidade",
        raso
          ? `a profundidade declarada (${d}) e MAIS RASA que o marco 'safe' da propria rede (${ateSafe} blocos) - ela nao protege contra o que a rede considera reversivel`
          : `a profundidade declarada (${d}) alcanca o marco 'safe' da rede (${ateSafe} blocos)`,
      );
    } else {
      console.log("   (sem 'safe' exposto, nao da pra comparar a profundidade declarada)");
    }
  } catch (err) {
    console.log(`   nao foi possivel ler os marcos: ${descreve(err)}`);
  }

  resumo(integration.supportStatus);
}

function resumo(statusAtual: string): void {
  const quebraMonitoramento = resultados.filter((r) => !r.ok && r.peso === "monitoramento");
  const capacidadeAusente = resultados.filter((r) => !r.ok && r.peso === "capacidade");

  console.log("\n=== Resumo ===");
  for (const r of resultados) console.log(`${r.ok ? "OK  " : "FALHA"} ${r.nome} (${r.peso})`);

  if (quebraMonitoramento.length > 0) {
    console.log(`\nFALHOU: ${quebraMonitoramento.length} verificacao(oes) do caminho de MONITORAMENTO.`);
    console.log("O produto nao funciona nesta rede com este RPC. Nao promova o status.");
    process.exitCode = 1;
    return;
  }

  console.log("\nO caminho de MONITORAMENTO funciona nesta rede com este RPC.");
  console.log("(saldo + cursor e tudo que o monitor de uma chain EVM generica usa:");
  console.log(" getConfirmedLogs so roda quando ha extensao de protocolo, que so a Tempo tem.)");

  if (capacidadeAusente.length > 0) {
    console.log(`\nATENCAO: ${capacidadeAusente.length} capacidade(s) DECLARADA(S) nao se confirmaram:`);
    for (const r of capacidadeAusente) console.log(`  - ${r.nome}: ${r.detalhe}`);
    console.log("Nao impede monitorar hoje, mas a declaracao em ChainCapabilities deixou");
    console.log("de ser verdade com este RPC. Registre como limitacao conhecida na matriz,");
    console.log("e saiba que qualquer extensao de protocolo futura falhara aqui.");
  }

  console.log(`\nStatus atual no registro: ${statusAtual}`);
  console.log("\nO que ISTO ainda nao autoriza, e por que:");
  console.log("  - `validating` exige tambem justificar a profundidade de confirmacao");
  console.log("    para esta rede (confirmationJustified) e um mantenedor declarado.");
  console.log("  - Uma execucao bem-sucedida e um instante, nao um historico. `stable`");
  console.log("    exige tempo de operacao, que nao se declara - se acumula.");
  console.log("\nCole a saida acima na matriz, com a data, como evidencia do que foi medido.");
}

function descreve(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

void main().catch((err) => {
  console.error("\n[fatal]", descreve(err));
  process.exit(1);
});
