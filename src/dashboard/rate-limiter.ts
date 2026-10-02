/**
 * Rate limiting de tentativa de login - janela fixa por identificador (ex:
 * IP ou userId). Sem isto, o login (que protege o único lugar onde saldo e
 * endereço completo aparecem) fica aberto a força bruta.
 */

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
  ) {}

  /** Retorna true se a tentativa é permitida, e já conta ela. */
  attempt(identifier: string, now: number = Date.now()): boolean {
    const existing = this.windows.get(identifier);

    if (!existing || now > existing.resetAt) {
      this.windows.set(identifier, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (existing.count >= this.maxAttempts) return false;

    existing.count += 1;
    return true;
  }

  /** Chamar após login bem-sucedido, pra não penalizar tentativas futuras legítimas. */
  reset(identifier: string): void {
    this.windows.delete(identifier);
  }
}
