/**
 * Adapta um handler de requisição `async` para o `RequestListener` do Node.
 *
 * Existe por um bug real, confirmado empiricamente no Node 22+ e 24:
 *
 *     createServer(async (req, res) => { ... })   // ERRADO
 *
 * `RequestListener` devolve `void`. Quando se passa uma função `async`, o
 * Node recebe uma Promise e a descarta - não existe ninguém para tratar a
 * rejeição. E desde o Node 15 o comportamento padrão para rejeição não
 * tratada é `throw`, que sem `uncaughtException` registrado **encerra o
 * processo** (reproduzido: exit code 1).
 *
 * Por que isso era grave aqui e não só feio: o processo que serve o webhook é
 * o MESMO que roda todos os monitores de tesouraria (ver index.ts). Uma
 * requisição que fizesse `handleWebhookRequest` lançar - e ele não tinha
 * try/catch próprio - derrubava o processo inteiro, e com ele toda a
 * vigilância. Pro dono da tesouraria, a vigilância simplesmente parava, sem
 * alerta nenhum avisando que parou. Num produto cuja promessa é vigiar, essa
 * é a pior forma de falhar.
 *
 * Achado pelo ESLint (`@typescript-eslint/no-misused-promises`), que é o
 * motivo pelo qual vale rodar regra com tipo no CI: nenhuma revisão humana
 * olha um `createServer(async ...)` e vê um processo morrendo.
 */

import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

export type AsyncRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Converte um handler assíncrono num listener síncrono que NUNCA deixa uma
 * rejeição escapar.
 *
 * `label` entra no log pra distinguir qual servidor falhou (painel, webhook,
 * combinado) - três call sites compartilham esta função.
 *
 * A resposta de erro é genérica de propósito: a mensagem do erro pode conter
 * detalhe interno, e o conteúdo que sai pra rede neste projeto nunca revela
 * estado interno (mesmo princípio de `alert-content-policy.ts`, ainda que
 * aqui o canal seja HTTP e não alerta). O erro completo vai pro log do
 * servidor, que é onde quem opera consegue ler.
 */
export function asRequestListener(handler: AsyncRequestHandler, label: string): RequestListener {
  return (req, res) => {
    handler(req, res).catch((err: unknown) => {
      console.error(`[${label}] erro não tratado no ciclo de requisição:`, err);

      // Resposta já concluída: não há nada a enviar, e tentar escrever
      // lançaria por cima do erro original.
      if (res.writableEnded) return;

      // Cabeçalho já enviado (o handler falhou no meio de escrever o corpo):
      // não dá pra trocar o status por 500. Encerra o que está pendente, pra
      // o cliente não ficar esperando uma resposta que nunca vem - o corpo
      // truncado é o melhor resultado possível a esta altura.
      if (res.headersSent) {
        res.end();
        return;
      }

      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Erro interno.");
    });
  };
}
