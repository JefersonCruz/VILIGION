/**
 * Mede quanto tempo passa entre o saldo mudar na rede e o alerta sair daqui.
 *
 *   npx tsx scripts/medir-latencia-do-alerta.ts
 *   npx tsx scripts/medir-latencia-do-alerta.ts --chain base --amostras 40
 *   npx tsx scripts/medir-latencia-do-alerta.ts --todas
 *
 * Por que existe: o produto é vigilância, e a promessa é velocidade. Até
 * agora o único número publicado sobre isso era o intervalo de polling
 * (15s), que é uma CONFIGURAÇÃO, não uma medição - não diz nada sobre quanto
 * o RPC demora, e portanto não diz quanto o dono espera de verdade. Depois
 * dos ataques à Binance (29/10/2026, ~20 min, dez redes) e ao Mercado
 * Bitcoin (02/11/2026), "quanto tempo até alguém saber" virou a pergunta
 * central do produto, e responder com um número de configuração seria
 * responder outra coisa.
 *
 * O QUE ESTE SCRIPT MEDE
 *
 *   1. leitura de saldo no RPC real, N amostras, por rede
 *   2. avaliação da regra (BalanceWindow) sobre uma janela já cheia
 *   3. a espera do ciclo, que é o termo que domina e é determinístico
 *
 * O QUE ELE NÃO MEDE - e isto importa mais que o que ele mede:
 *
 *   - escrita do alerta no banco e leitura/decifragem dos destinatários:
 *     precisam de um Postgres. São awaits no caminho crítico (ver
 *     makeDispatcher em index.ts) e entram no total real.
 *   - aceitação da chamada pela Twilio: precisa de credencial e custa.
 *   - **o telefone tocar, e alguém atender.** Isto não é mensurável daqui
 *     por construção: depende de operadora, de aparelho e de pessoa. E é
 *     exatamente a parte que o dono experimenta.
 *
 * Ou seja: o número que sai aqui é "até o alerta sair", não "até o dono
 * saber". A diferença entre os dois não é detalhe, e nenhum texto de
 * marketing deve apagá-la.
 *
 * Não é teste automatizado: toca rede real, demora, e por isso fica em
 * `scripts/` e nunca em `npm test` - mesma razão de measure-reorgs.ts.
 */

import { buildChainIntegration } from "../src/engine/chains/chain-registry.js";
import { KNOWN_CHAINS } from "../src/engine/chains/known-chains.js";
import { BalanceWindow } from "../src/engine/rules/balance-window.js";
import type { UserThresholds } from "../src/engine/rules/detection-rules.js";

/** O mesmo valor que index.ts passa pro Monitor. Se mudar lá, muda aqui. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Endereço de queima, usado só pra ter uma leitura de saldo válida em
 * qualquer rede EVM. Não pertence a ninguém e não é dado de usuário.
 */
const ENDERECO_NEUTRO = "0x000000000000000000000000000000000000dEaD";

const LIMIARES: UserThresholds = {
  userId: "medicao",
  maxBalanceDropPct: 10,
  criticalBalanceDropPct: 30,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 0n,
  criticalBlockedTransferThreshold: 0n,
};

interface Args {
  chains: string[];
  amostras: number;
  endereco: string;
  /**
   * TIP-20/ERC-20 a ler em vez do saldo nativo.
   *
   * Obrigatório na Tempo, que não tem gas token nativo: sem ele o adaptador
   * recusa a leitura em vez de devolver um número que não é a tesouraria.
   * Ver `ChainCapabilities` em chain-adapter.ts - capacidade ausente é
   * declarada, não simulada.
   */
  token?: string;
}

function lerArgs(argv: string[]): Args {
  const pegar = (nome: string): string | undefined => {
    const i = argv.indexOf(nome);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const todas = argv.includes("--todas");
  const chain = pegar("--chain");
  return {
    chains: todas ? Object.keys(KNOWN_CHAINS) : [chain ?? "tempo"],
    amostras: Number(pegar("--amostras") ?? 20),
    endereco: pegar("--endereco") ?? ENDERECO_NEUTRO,
    token: pegar("--token"),
  };
}

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return NaN;
  const ordenado = [...valores].sort((a, b) => a - b);
  const i = Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length));
  return ordenado[i]!;
}

const ms = (n: number): string => (Number.isNaN(n) ? "   -  " : `${n.toFixed(0).padStart(5)}ms`);

/** Quanto a regra demora, com a janela já cheia de um dia de amostras. */
function medirRegra(amostras: number): number[] {
  const janela = new BalanceWindow();
  const t0 = Date.UTC(2026, 10, 2);
  // enche com 24h de pontos a cada 15s, que é o pior caso que o monitor vive
  const pontos = Math.floor((24 * 3600_000) / POLL_INTERVAL_MS);
  for (let i = 0; i < pontos; i++) {
    janela.evaluate(1_000_000n, new Date(t0 + i * POLL_INTERVAL_MS), LIMIARES);
  }
  const tempos: number[] = [];
  for (let i = 0; i < amostras; i++) {
    const quando = new Date(t0 + (pontos + i) * POLL_INTERVAL_MS);
    const inicio = performance.now();
    janela.evaluate(1_000_000n - BigInt(i), quando, LIMIARES);
    tempos.push(performance.now() - inicio);
  }
  return tempos;
}

async function medirRede(chainKey: string, args: Args): Promise<void> {
  const nome = KNOWN_CHAINS[chainKey]?.name ?? chainKey;
  process.stdout.write(`\n${nome} (${chainKey})\n`);

  let adapter;
  try {
    ({ adapter } = buildChainIntegration({
      chainKey,
      tokenAddress: args.token as `0x${string}` | undefined,
    }));
  } catch (err) {
    console.log(`  ${(err as Error).message}`);
    if (!args.token) console.log(`  → passe --token <endereço> para medir esta rede.`);
    return;
  }

  const leituras: number[] = [];
  let falhas = 0;
  for (let i = 0; i < args.amostras; i++) {
    const inicio = performance.now();
    try {
      await adapter.getBalance(args.endereco);
      leituras.push(performance.now() - inicio);
    } catch {
      falhas++;
    }
  }

  if (leituras.length === 0) {
    console.log(`  RPC não respondeu em ${args.amostras} tentativas - sem número para esta rede.`);
    return;
  }
  if (falhas > 0) console.log(`  (${falhas} de ${args.amostras} leituras falharam)`);

  const regra = medirRegra(50);

  // A espera do ciclo é uniforme entre 0 e o intervalo: uma mudança de saldo
  // cai em qualquer ponto entre dois ticks. E o sleep acontece DEPOIS do
  // tick (ver monitor.ts#start), então o período real é intervalo + leitura.
  const esperaMediana = POLL_INTERVAL_MS / 2;
  const leituraP50 = percentil(leituras, 50);
  const leituraP95 = percentil(leituras, 95);
  const regraP95 = percentil(regra, 95);

  console.log(`  leitura de saldo no RPC   p50 ${ms(leituraP50)}   p95 ${ms(leituraP95)}   máx ${ms(Math.max(...leituras))}`);
  console.log(`  avaliação da regra        p50 ${ms(percentil(regra, 50))}   p95 ${ms(regraP95)}`);
  console.log(`  espera do ciclo           0 a ${POLL_INTERVAL_MS}ms (uniforme), mediana ${esperaMediana}ms`);
  console.log(
    `  → até o alerta sair       típico ${((esperaMediana + leituraP50 + regraP95) / 1000).toFixed(1)}s   ` +
      `pior caso ${((POLL_INTERVAL_MS + leituraP95 + regraP95) / 1000).toFixed(1)}s`,
  );
}

async function main(): Promise<void> {
  const args = lerArgs(process.argv.slice(2));
  console.log(`Latência até o alerta sair — ${args.amostras} amostras por rede, endereço ${args.endereco}`);
  console.log(`Intervalo de polling configurado: ${POLL_INTERVAL_MS}ms (index.ts)`);

  for (const chainKey of args.chains) {
    await medirRede(chainKey, args);
  }

  console.log(`
NÃO está incluído acima, e entra no total real:
  - gravar o alerta no banco, e ler + decifrar os destinatários (dois awaits
    no caminho crítico, ver makeDispatcher em index.ts)
  - a Twilio aceitar a chamada
  - o telefone tocar, e alguém atender

O último item não é mensurável daqui, e é o que o dono vive. Este número é
"até o alerta sair", nunca "até o dono saber".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
