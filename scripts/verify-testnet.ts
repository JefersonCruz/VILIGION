/**
 * Smoke test contra a rede real da Tempo (testnet Moderato) — não é teste
 * unitário, é verificação manual de que as premissas do adaptador batem com
 * a rede de verdade. Rode com: npx tsx scripts/verify-testnet.ts
 *
 * Não requer .env nem conta Twilio — só confirma RPC, endereços e ABI.
 */

import { createPublicClient, http, type Address } from "viem";
import { tempoModerato } from "viem/chains";
import { Actions, Addresses } from "viem/tempo";
import { RECEIVE_POLICY_GUARD_ADDRESS, TempoAdapter } from "../src/engine/chains/tempo.adapter.js";

const RANDOM_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

async function main() {
  console.log("=== 1. Conectividade RPC ===");
  const client = createPublicClient({ chain: tempoModerato, transport: http() });
  const blockNumber = await client.getBlockNumber();
  console.log(`✅ RPC respondeu. Bloco atual (Moderato): ${blockNumber}`);

  console.log("\n=== 2. Endereço do ReceivePolicyGuard: hardcoded vs. oficial (viem/tempo) ===");
  console.log(`VILIGION (tempo.adapter.ts): ${RECEIVE_POLICY_GUARD_ADDRESS}`);
  console.log(`viem/tempo (Addresses.receivePolicyGuard): ${Addresses.receivePolicyGuard}`);
  console.log(
    RECEIVE_POLICY_GUARD_ADDRESS.toLowerCase() === Addresses.receivePolicyGuard.toLowerCase()
      ? "✅ Batem."
      : "❌ NÃO BATEM — investigar antes de confiar no decode.",
  );

  console.log("\n=== 3. O contrato realmente existe nesse endereço na rede? (eth_getCode) ===");
  const code = await client.getCode({ address: Addresses.receivePolicyGuard as Address });
  console.log(
    code && code !== "0x"
      ? `✅ Bytecode presente (${(code.length - 2) / 2} bytes) — contrato deployado de verdade.`
      : "❌ Sem bytecode nesse endereço — o contrato não existe aí nesta rede.",
  );

  console.log("\n=== 4. eth_getBalance (saldo NATIVO) num endereço aleatório ===");
  const nativeBalance = await client.getBalance({ address: RANDOM_ADDRESS });
  console.log(`eth_getBalance → ${nativeBalance} (unidade nativa, ${tempoModerato.nativeCurrency.decimals} decimais)`);
  console.log(
    "⚠️  Isto é o que EvmAdapter.getBalance() usa hoje. Precisa decidir: a Tempo trata isto como " +
      "saldo TIP-20 por baixo (precompile), ou é um valor sempre irrelevante pra tesouraria real? " +
      "Ver resultado do passo 5 pra comparar com o saldo TIP-20 de verdade.",
  );

  console.log("\n=== 5. Actions.token.getBalance (saldo TIP-20 via ação oficial do viem/tempo) ===");
  try {
    const tokenBalance = await Actions.token.getBalance(client, {
      account: RANDOM_ADDRESS,
      token: Addresses.pathUsd as Address,
    });
    console.log(`Actions.token.getBalance (pathUsd) → ${JSON.stringify(tokenBalance, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    console.log("✅ A chamada oficial de saldo TIP-20 funciona contra a rede real.");
  } catch (err) {
    console.log("❌ Actions.token.getBalance falhou:", err instanceof Error ? err.message : err);
  }

  console.log("\n=== 6. getLogs no ReceivePolicyGuard (últimos 10.000 blocos) ===");
  const fromBlock = blockNumber > 10_000n ? blockNumber - 10_000n : 0n;
  const adapter = new TempoAdapter({
    rpcUrl: tempoModerato.rpcUrls.default.http[0] as string,
    chainId: tempoModerato.id,
    minConfirmations: 1,
    receivePolicyGuardAddress: Addresses.receivePolicyGuard as Address,
  });
  const blocked = await adapter.getBlockedTransfers(fromBlock);
  console.log(`✅ getLogs não deu erro. TransferBlocked encontrados na janela: ${blocked.length}`);
  if (blocked.length > 0) {
    console.log("Primeiro evento decodificado:", blocked[0]);
  } else {
    console.log("(Esperado se nenhuma transferência foi bloqueada recentemente nesta janela — não é falha.)");
  }

  console.log("\n=== Resumo ===");
  console.log("Itens 1, 2, 3 e 6 validam as premissas do decoder TransferBlocked/ReceivePolicyGuard.");
  console.log("Item 4 vs. 5 decide se EvmAdapter.getBalance() está lendo o número certo pro produto.");
}

main().catch((err) => {
  console.error("\n[verify-testnet] falhou:", err);
  process.exit(1);
});
