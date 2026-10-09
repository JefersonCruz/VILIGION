/** Casas decimais assumidas para stablecoins em dólar (TIP-20 da Tempo, USDC etc.). */
export const TOKEN_DECIMALS = 6;

/**
 * "2000", "2000.5" ou "2000,5" (até `decimals` casas) -> menor unidade do token.
 * Só bigint: converter via Number perderia precisão em valores grandes.
 * Devolve null se o texto não for um valor em dólar válido.
 */
export function parseUsdToUnits(input: string | undefined, decimals = TOKEN_DECIMALS): bigint | null {
  const text = (input ?? "").trim();
  const match = /^(\d{1,15})(?:[.,](\d+))?$/.exec(text);
  if (!match) return null;
  const whole = match[1] as string;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/**
 * Menor unidade -> texto pra EXIBIR em tela, pt-BR, sempre 2 casas e separador
 * de milhar ("42.180,32"). Diferente de `unitsToUsdString`, que é pra
 * ida-e-volta sem perda (sem zeros à direita) e serve de valor de formulário.
 *
 * Sem `Number` no caminho, pelo mesmo motivo de `parseUsdToUnits`: saldo de
 * tesouraria pode passar do inteiro seguro do JS. Trunca o que passa de dois
 * centavos em vez de arredondar - num produto que vigia saldo, mostrar
 * centavo a mais do que existe é pior que mostrar a menos.
 */
export function formatUsdDisplay(units: bigint, decimals = TOKEN_DECIMALS): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const grouped = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = (abs % base).toString().padStart(decimals, "0").slice(0, 2);
  return `${negative ? "-" : ""}${grouped},${cents}`;
}

/** Menor unidade -> texto em dólar sem zeros à direita ("2000", "0.5"). */
export function unitsToUsdString(units: bigint, decimals = TOKEN_DECIMALS): string {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
