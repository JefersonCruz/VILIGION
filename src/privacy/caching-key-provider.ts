/**
 * Decorador de `KeyProvider` que memoriza o desempacotamento de DEKs.
 *
 * ---
 *
 * POR QUE EXISTE
 *
 * `docs/KMS-OPTIONS.md` registra a restrição que torna a issue #9 difícil:
 * destinatários são decifrados NO CAMINHO DO ALERTA (`listForUser` chama
 * `encryption.decrypt`, e o despachante a chama toda vez que um alerta sai).
 * Com um KMS remoto, isso vira uma chamada de rede a um terceiro entre a
 * anomalia e o telefone do dono - a forma de dependência que este projeto
 * recusa no caminho crítico.
 *
 * Olhando onde a chamada remota de fato estaria, ela é estreita: só
 * `decryptDataKey`. A leitura do banco e a decifragem do conteúdo continuam
 * locais. Então dá pra tirar o KMS do caminho quente cacheando apenas isso.
 *
 * ---
 *
 * POR QUE NÃO CACHEAR OS DESTINATÁRIOS
 *
 * A opção C do documento propunha resolver os destinatários uma vez e manter
 * em memória. Isso tem um modo de falha ruim: se a invalidação falhar, um
 * alerta vai pra um número que o dono ACABOU DE REMOVER. Num produto sobre
 * não vazar a ligação entre pessoa e tesouraria, mandar alerta pra destino
 * removido é exatamente o erro que não se pode cometer.
 *
 * Cacheando só a DEK, esse risco não existe: o banco continua sendo lido a
 * cada alerta, então remoção e inclusão valem na hora. O que se reaproveita é
 * só a chave que abre um registro - e se o registro sumiu, ninguém pergunta
 * pela chave dele.
 *
 * ---
 *
 * O QUE ISTO CUSTA, HONESTAMENTE
 *
 * DEKs em claro ficam na memória do processo enquanto estiverem em cache.
 * É melhor que o estado de hoje - a chave MESTRA numa variável de ambiente,
 * que foi o que vazou em 22/10 - porque um vazamento de variáveis de ambiente
 * não expõe memória de processo. Mas é mais fraco que "a chave nunca existe
 * no nosso processo", e a documentação precisa dizer "em cache por N minutos"
 * em vez disso.
 *
 * E o ganho HOJE é praticamente zero: o provider local desempacota com AES em
 * memória, que já é barato. Isto é preparação - faz com que adotar um KMS
 * depois seja trocar o provider, não redesenhar o caminho do alerta.
 */

import type { KeyProvider } from "./encryption.js";

export interface CachingKeyProviderOptions {
  /**
   * Por quanto tempo uma DEK desempacotada pode ser reaproveitada.
   *
   * Existe como rede de segurança, não como otimização: limita por quanto
   * tempo material de chave fica em memória, e garante que uma chave mestra
   * rotacionada passe a valer sem reiniciar o processo (ver
   * scripts/rotate-encryption-key.ts - depois da rotação, o envelope antigo
   * nem é mais consultado, mas o teto temporal vale pra qualquer cenário que
   * não antecipamos).
   */
  readonly ttlMs?: number;
  /** Quantas DEKs distintas manter. Limita o crescimento num processo que roda sem parar. */
  readonly maxEntries?: number;
  /** Injetável pra o teste não depender do relógio real. */
  readonly now?: () => number;
}

interface Entrada {
  readonly chave: Buffer;
  readonly expiraEm: number;
}

export class CachingKeyProvider implements KeyProvider {
  private readonly cache = new Map<string, Entrada>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  /** Contadores pra o painel admin poder mostrar se o cache está servindo de algo. */
  private acertos = 0;
  private erros = 0;

  constructor(
    private readonly inner: KeyProvider,
    options: CachingKeyProviderOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxEntries = options.maxEntries ?? 500;
    this.now = options.now ?? Date.now;
  }

  /**
   * Gerar DEK nova NUNCA é cacheado, e não poderia ser: cada chamada tem que
   * devolver uma chave diferente. Cachear aqui faria registros distintos
   * compartilharem DEK, que é precisamente o que a cifragem por envelope
   * existe pra evitar.
   */
  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: Buffer }> {
    return this.inner.generateDataKey();
  }

  /** Reempacotar é operação de rotação, rara e fora do caminho do alerta - passa direto. */
  async encryptDataKey(plaintextKey: Buffer): Promise<Buffer> {
    return this.inner.encryptDataKey(plaintextKey);
  }

  async decryptDataKey(encryptedKey: Buffer): Promise<Buffer> {
    const id = encryptedKey.toString("base64");
    const agora = this.now();

    const guardada = this.cache.get(id);
    if (guardada && guardada.expiraEm > agora) {
      this.acertos++;
      // Cópia: quem chama costuma zerar o buffer depois de usar (ver
      // MappingEncryption.decrypt), e isso destruiria a entrada do cache
      // para todo mundo.
      return Buffer.from(guardada.chave);
    }
    if (guardada) this.cache.delete(id);

    this.erros++;
    /*
     * Falha NÃO é cacheada, de propósito. Um KMS indisponível, ou uma chave
     * mestra recém-rotacionada, produzem erro aqui - e memorizar isso faria
     * uma indisponibilidade momentânea virar uma falha fixa pelo resto do TTL,
     * no caminho do alerta. Erro passa, e a próxima tentativa tenta de novo.
     */
    const chave = await this.inner.decryptDataKey(encryptedKey);

    this.guardar(id, Buffer.from(chave), agora);
    return chave;
  }

  private guardar(id: string, chave: Buffer, agora: number): void {
    this.cache.set(id, { chave, expiraEm: agora + this.ttlMs });
    while (this.cache.size > this.maxEntries) {
      const maisAntiga = this.cache.keys().next();
      if (maisAntiga.done) break;
      const removida = this.cache.get(maisAntiga.value);
      removida?.chave.fill(0); // não deixa material de chave vivo depois de descartado
      this.cache.delete(maisAntiga.value);
    }
  }

  /** Descarta tudo e zera o material de chave. Para usar depois de rotacionar a chave mestra. */
  clear(): void {
    for (const e of this.cache.values()) e.chave.fill(0);
    this.cache.clear();
  }

  /** Leitura pura, pro painel admin - nunca expõe material de chave. */
  stats(): { entradas: number; acertos: number; erros: number } {
    return { entradas: this.cache.size, acertos: this.acertos, erros: this.erros };
  }
}
