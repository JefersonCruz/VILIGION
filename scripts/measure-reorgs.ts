/**
 * Mede com que frequencia um bloco a N confirmacoes deixa de ser canonico.
 *
 *   npx tsx scripts/measure-reorgs.ts --chain arbitrum
 *   npx tsx scripts/measure-reorgs.ts --chain base --depth 3 --minutes 60
 *
 * Por que existe: `docs/REORG-REWIND-OPTIONS.md` compara quatro caminhos pra
 * tratar reorg, e conclui que nenhum deles deve ser escolhido antes de alguem
 * medir QUANTO o problema acontece de verdade. Este script e esse "antes".
 *
 * Como funciona: a cada ciclo, anota o hash do bloco que esta a `depth`
 * confirmacoes do topo - exatamente o bloco em que o monitor confiaria pra
 * disparar um alerta. Mais tarde, pergunta de novo pelo bloco daquele MESMO
 * numero. Se o hash mudou, aquele bloco saiu da cadeia canonica: um alerta
 * disparado com base nele teria sido um alerta sobre algo que nao aconteceu.
 *
 * Rode por horas, nao minutos. Reorg a 3 confirmacoes e raro o suficiente pra
 * que dez minutos de amostra quase sempre deem zero - e zero numa amostra
 * curta NAO e evidencia de que nao acontece. O script diz isso no resumo em
 * vez de deixar quem leu concluir sozinho.
 *
 * Nao e teste automatizado: toca rede real, demora, e por isso fica em
 * `scripts/` e nunca em `npm test`.
 */

import { createPublicClient, http } from "viem";
import { getChainIntegration } from "../src/engine/chains/chain-registry.js";
import { resolveRpcUrl, KNOWN_CHAINS } from "../src/engine/chains/known-chains.js";

interface Args {
  chain: string;
  depth: bigint;
  minutes: number;
  intervalSeconds: number;
  rpc?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const chain = get("chain");
  if (!chain) {
    console.error("Uso: npx tsx scripts/measure-reorgs.ts --chain <rede> [--depth 3] [--minutes 60] [--interval 10]");
    console.error(`Redes: ${Object.keys(KNOWN_CHAINS).join(", ")}`);
    process.exit(2);
  }
  return {
    chain,
    depth: BigInt(get("depth") ?? String(getChainIntegration(chain).defaultMinConfirmations)),
    minutes: Number(get("minutes") ?? 60),
    intervalSeconds: Number(get("interval") ?? 10),
    rpc: get("rpc"),
  };
}

const dorme = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rpcUrl = resolveRpcUrl(args.chain, args.rpc);
  const client = createPublicClient({ transport: http(rpcUrl) });

  console.log(`Medindo reorg em "${args.chain}" a ${args.depth} confirmacao(oes)`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Duracao: ${args.minutes} min, amostra a cada ${args.intervalSeconds}s`);
  console.log(`Pare antes com Ctrl+C - o resumo sai mesmo assim.\n`);

  /** numero do bloco -> hash que vimos quando ele estava a `depth` do topo */
  const observados = new Map<string, string>();
  let amostras = 0;
  let reconferidos = 0;
  let trocados = 0;
  const trocas: string[] = [];

  const fim = Date.now() + args.minutes * 60_000;
  const resumir = (): void => {
    console.log("\n=== Resumo ===");
    console.log(`rede                 : ${args.chain}`);
    console.log(`profundidade medida  : ${args.depth}`);
    console.log(`amostras             : ${amostras}`);
    console.log(`blocos reconferidos  : ${reconferidos}`);
    console.log(`blocos que MUDARAM   : ${trocados}`);
    for (const t of trocas) console.log(`   ${t}`);
    if (reconferidos === 0) {
      console.log("\nAmostra curta demais pra concluir qualquer coisa.");
    } else if (trocados === 0) {
      const taxa = (1 / reconferidos) * 100;
      console.log(`\nNenhum bloco mudou em ${reconferidos} reconferencias.`);
      console.log(`Isso NAO prova que nao acontece: com esta amostra, so da pra dizer`);
      console.log(`que a taxa esta abaixo de ~${taxa.toFixed(2)}% - um evento mais raro`);
      console.log(`que isso passaria despercebido. Rode por mais tempo pra apertar o limite.`);
    } else {
      console.log(`\nTaxa observada: ${((trocados / reconferidos) * 100).toFixed(2)}% das reconferencias.`);
      console.log(`Cada uma dessas e um alerta que teria sido disparado sobre um evento`);
      console.log(`que deixou de existir - ver docs/REORG-REWIND-OPTIONS.md.`);
    }
  };

  process.on("SIGINT", () => {
    resumir();
    process.exit(0);
  });

  while (Date.now() < fim) {
    try {
      const topo = await client.getBlockNumber();
      const alvo = topo - args.depth;

      // 1. Anota o bloco em que o monitor confiaria AGORA.
      if (alvo > 0n && !observados.has(alvo.toString())) {
        const b = await client.getBlock({ blockNumber: alvo });
        observados.set(alvo.toString(), b.hash);
        amostras++;
      }

      // 2. Reconfere os que ja estao bem atras do topo - se mudaram, o bloco
      //    em que teriamos confiado saiu da cadeia.
      for (const [numero, hashVisto] of observados) {
        const n = BigInt(numero);
        if (topo - n < args.depth * 10n) continue; // ainda cedo pra reconferir
        const atual = await client.getBlock({ blockNumber: n });
        reconferidos++;
        if (atual.hash !== hashVisto) {
          trocados++;
          const linha = `bloco ${numero}: ${hashVisto.slice(0, 10)}... -> ${atual.hash.slice(0, 10)}...`;
          trocas.push(linha);
          console.log(`REORG  ${linha}`);
        }
        observados.delete(numero);
      }

      if (amostras % 20 === 0 && amostras > 0) {
        console.log(`... ${amostras} amostras, ${reconferidos} reconferidos, ${trocados} mudaram`);
      }
    } catch (err) {
      console.log(`(erro de RPC, seguindo: ${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
    }
    await dorme(args.intervalSeconds * 1000);
  }

  resumir();
}

void main().catch((err) => {
  console.error("[fatal]", err instanceof Error ? err.message : err);
  process.exit(1);
});
