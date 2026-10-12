/**
 * Ativos mínimos de PWA pro canal de alerta sem telefone (Web Push).
 *
 * Decisão deliberada: este service worker NÃO faz cache de nada. Um PWA
 * "normal" cacheia o app shell, mas aqui o conteúdo que importa é saldo e
 * histórico de alerta - servir uma versão velha disso seria pior que não
 * funcionar offline, e cache de shell perto de um deadline é uma classe
 * inteira de bug que não precisamos. O service worker existe por um motivo
 * só: receber push quando a aba está fechada.
 *
 * Ícones (2026-10-12): 192 e 512 gerados da arte em alta resolução, mais um
 * badge monocromático - ver scripts/generate-icons.mjs e a nota em
 * server.ts#STATIC_IMAGES. Com 192px+ declarado, o Chrome passa a oferecer
 * "instalar". No iOS o app ainda precisa ir pra tela de início manualmente
 * antes de aceitar push - é o trade-off registrado em alerts/web-push.ts (o
 * canal mais privado é o menos garantido).
 */

/**
 * `requireInteraction` mantém a notificação na tela até o usuário agir, em vez
 * de sumir em alguns segundos - é um alerta de tesouraria às 3h da manhã, não
 * uma curtida. `renotify` com `tag` fixa faz o dispositivo tocar de novo em
 * vez de substituir silenciosamente.
 */
export function serviceWorkerSource(): string {
  return `// VILIGION service worker - só push, sem cache (ver src/dashboard/pwa-assets.ts).
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = {};
  }

  var title = data.title || "VILIGION";
  var url = data.url || "/dashboard";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // Sem "icon" o Android mostra o icone generico do navegador - o alerta
      // mais importante do produto chegava sem marca nenhuma. E a marca "V"
      // SOZINHA: o lockup com a palavra "VILIGION", a ~48px, vira borrao.
      icon: "/icon-192.png",
      // Silhueta branca sobre transparente: o Android mascara o badge pelo
      // canal ALPHA, entao um PNG opaco viraria quadrado solido na barra de
      // status. Gerado a partir da luminancia da arte original.
      badge: "/badge.png",
      tag: "viligion-alert",
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300],
      timestamp: data.at || Date.now(),
      lang: data.lang || "pt-BR",
      data: { url: url },
      actions: data.actionLabel ? [{ action: "open", title: data.actionLabel }] : []
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url.indexOf(url) === 0 && "focus" in clientList[i]) {
          return clientList[i].focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
`;
}

/**
 * `start_url` aponta pro painel, não pra landing: quem instalou já é usuário,
 * e o detalhe real do alerta só existe depois do login.
 */
export function manifestJson(params: { iconPath: string }): string {
  return JSON.stringify(
    {
      name: "VILIGION",
      short_name: "VILIGION",
      description: "Monitoramento de tesouraria com alerta crítico sem expor número de telefone.",
      start_url: "/dashboard",
      scope: "/",
      display: "standalone",
      background_color: "#0A0E17",
      theme_color: "#0A0E17",
      icons: [
        { src: params.iconPath, sizes: "128x128", type: "image/png", purpose: "any" },
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        // "maskable" so vale porque o "V" ocupa 62% do quadrado - dentro da
        // zona segura que o Android preserva ao recortar com a mascara do
        // aparelho. Declarar maskable num icone que usa a borda toda faz o
        // sistema cortar a marca.
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    null,
    2,
  );
}

/**
 * Script da tela /recipients: registra o service worker, pede permissão de
 * notificação e manda a inscrição pro servidor. Fica aqui (e não inline na
 * view) pra poder ser testado como string e revisado isolado.
 *
 * A chave VAPID pública é entregue pelo servidor em /push/config - é pública
 * por definição (vai no cabeçalho de todo envio), mas não é hardcoded aqui
 * pra permitir rotação sem rebuild.
 */
export function pushEnrollScript(): string {
  return `<script>
(function () {
  var btn = document.getElementById("pushEnable");
  var msg = document.getElementById("pushMsg");
  if (!btn) return;

  function say(text) { if (msg) msg.textContent = text; }

  // Checagem de capacidade ANTES de qualquer clique. "Notification" entrou
  // nesta lista em 2026-10-12: sem ele, Notification.requestPermission()
  // lançava de forma SÍNCRONA (ReferenceError), fora da cadeia de promise -
  // o .catch() nunca rodava e a tela congelava em "Pedindo permissão..." com
  // o botão desabilitado e nenhuma explicação. É o caso do webview do VS Code
  // (Simple Browser) e de qualquer contexto que não expõe a API.
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    btn.disabled = true;
    say("Este navegador não expõe a API de notificação. Abra em Chrome, Edge ou Firefox - visualizadores embutidos (como o navegador do VS Code ou de apps) costumam bloquear. Em iPhone, adicione o app à tela de início primeiro.");
    return;
  }

  // Permissão já negada antes: o navegador NÃO mostra prompt de novo, então
  // sem esta checagem o usuário clica e nada acontece visivelmente.
  if (Notification.permission === "denied") {
    btn.disabled = true;
    say("Notificações estão bloqueadas para este site. Libere no ícone de cadeado da barra de endereço e recarregue.");
    return;
  }

  // base64url -> Uint8Array, formato que applicationServerKey exige.
  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  /**
   * Safari antigo (e alguns webviews) ainda usam a forma de CALLBACK de
   * requestPermission, que devolve undefined - chamar .then() nela lança, e o
   * erro cai fora de qualquer catch. Normaliza as duas formas numa promise.
   */
  function askPermission() {
    var pending = null;
    try {
      var result = Notification.requestPermission(function (p) {
        pending = p;
      });
      if (result && typeof result.then === "function") return result;
      return Promise.resolve(pending || Notification.permission);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  btn.addEventListener("click", function () {
    btn.disabled = true;
    say("Pedindo permissão...");

    // try/catch em volta de TUDO: qualquer lançamento síncrono aqui deixaria
    // o botão desabilitado sem mensagem, que é exatamente o sintoma
    // "cliquei e não aparece nada".
    try {
      run();
    } catch (err) {
      btn.disabled = false;
      say("Não deu: " + (err && err.message ? err.message : String(err)));
    }
  });

  function run() {
    askPermission()
      .then(function (permission) {
        if (permission !== "granted") throw new Error("permissão de notificação não concedida (" + permission + ")");
        say("Registrando dispositivo...");
        return navigator.serviceWorker.register("/sw.js", { scope: "/" });
      })
      .then(function (registration) {
        return navigator.serviceWorker.ready.then(function () { return registration; });
      })
      .then(function (registration) {
        return fetch("/push/config")
          .then(function (r) { return r.json(); })
          .then(function (cfg) {
            if (!cfg.publicKey) throw new Error("Servidor sem chave VAPID configurada.");
            return registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(cfg.publicKey)
            });
          });
      })
      .then(function (subscription) {
        return fetch("/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription)
        });
      })
      .then(function (response) {
        if (!response.ok) throw new Error("O servidor recusou a inscrição.");
        say("Dispositivo registrado. Recarregando...");
        window.location.reload();
      })
      .catch(function (err) {
        btn.disabled = false;
        say("Não deu: " + (err && err.message ? err.message : String(err)));
      });
  }
})();
</script>`;
}
