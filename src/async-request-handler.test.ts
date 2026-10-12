import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { asRequestListener } from "./async-request-handler.js";

/**
 * Resposta falsa com só o que o adaptador toca. Grava o que foi escrito pra
 * o teste poder afirmar o status e o corpo sem subir servidor nenhum.
 */
function fakeRes(initial: { headersSent?: boolean; writableEnded?: boolean } = {}) {
  return {
    headersSent: initial.headersSent ?? false,
    writableEnded: initial.writableEnded ?? false,
    statusCode: 0 as number,
    headers: null as Record<string, string> | null,
    body: null as string | undefined | null,
    endCalls: 0,
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      this.headers = headers ?? null;
      this.headersSent = true;
      return this;
    },
    end(chunk?: string) {
      this.endCalls++;
      this.body = chunk;
      this.writableEnded = true;
      return this;
    },
  };
}

const req = {} as IncomingMessage;
const asRes = (r: ReturnType<typeof fakeRes>) => r as unknown as ServerResponse;

/** Deixa a cadeia de `.catch()` interna do adaptador rodar antes de afirmar. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("asRequestListener", () => {
  it("handler que resolve: não escreve nada por cima da resposta", async () => {
    const res = fakeRes();
    const listener = asRequestListener(async (_req, r) => {
      (r as unknown as ReturnType<typeof fakeRes>).writeHead(200);
      (r as unknown as ReturnType<typeof fakeRes>).end("ok");
    }, "teste");

    listener(req, asRes(res));
    await flush();

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
    expect(res.endCalls).toBe(1);
  });

  it("devolve void, não Promise - é o que o RequestListener do Node exige", () => {
    // O ponto do arquivo inteiro: se isto devolvesse Promise, o Node a
    // descartaria e a rejeição derrubaria o processo (ver cabeçalho do
    // módulo). Guarda de regressão contra alguém "simplificar" o adaptador
    // devolvendo o resultado do handler direto.
    const listener = asRequestListener(async () => {}, "teste");

    expect(listener(req, asRes(fakeRes()))).toBeUndefined();
  });

  it("handler que rejeita antes de responder: devolve 500 em vez de deixar a rejeição escapar", async () => {
    const res = fakeRes();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const listener = asRequestListener(async () => {
      throw new Error("falha interna qualquer");
    }, "teste");

    listener(req, asRes(res));
    await flush();

    expect(res.statusCode).toBe(500);
    expect(res.body).toBe("Erro interno.");
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("a resposta de erro não vaza a mensagem do erro pra rede", async () => {
    const res = fakeRes();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const listener = asRequestListener(async () => {
      throw new Error("DATABASE_URL=postgres://segredo@host/db falhou");
    }, "teste");

    listener(req, asRes(res));
    await flush();

    // O detalhe interno vai pro log do servidor, nunca pro corpo da resposta.
    expect(res.body).toBe("Erro interno.");
    expect(res.body).not.toContain("postgres");
    expect(res.body).not.toContain("segredo");
    erro.mockRestore();
  });

  it("rejeição depois de o cabeçalho ter saído: encerra a resposta em vez de tentar um 500 impossível", async () => {
    const res = fakeRes({ headersSent: true });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const listener = asRequestListener(async () => {
      throw new Error("falhou no meio do corpo");
    }, "teste");

    listener(req, asRes(res));
    await flush();

    // Não dá pra trocar o status a esta altura; o que importa é o cliente não
    // ficar esperando uma resposta que nunca vem.
    expect(res.statusCode).toBe(0);
    expect(res.endCalls).toBe(1);
    expect(res.writableEnded).toBe(true);
    erro.mockRestore();
  });

  it("rejeição depois de a resposta ter sido concluída: não tenta escrever de novo", async () => {
    const res = fakeRes({ headersSent: true, writableEnded: true });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const listener = asRequestListener(async () => {
      throw new Error("falhou depois de responder");
    }, "teste");

    listener(req, asRes(res));
    await flush();

    // Escrever numa resposta encerrada lançaria por cima do erro original -
    // o erro vai pro log e o adaptador para aí.
    expect(res.endCalls).toBe(0);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("o label do servidor aparece no log, pra distinguir qual dos três falhou", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const listener = asRequestListener(async () => {
      throw new Error("x");
    }, "webhook");

    listener(req, asRes(fakeRes()));
    await flush();

    expect(erro.mock.calls[0]?.[0]).toContain("[webhook]");
    erro.mockRestore();
  });
});
