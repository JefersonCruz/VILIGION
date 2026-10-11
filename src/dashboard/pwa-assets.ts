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
 * Limitação conhecida e honesta: o ícone disponível hoje é 128x128
 * (logo-assets.ts). Android/Chrome só oferecem "instalar" com 192px+ e o iOS
 * exige o app na tela de início pra aceitar push. Então push funciona hoje em
 * Android/desktop sem instalar, e no iOS depende de instalação manual - é o
 * trade-off registrado em alerts/web-push.ts (o canal mais privado é o menos
 * garantido). Gerar 192/512 é item de acompanhamento, não bloqueio.
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
      tag: "viligion-alert",
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 120, 300, 120, 300],
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
      background_color: "#0b1220",
      theme_color: "#0b1220",
      icons: [{ src: params.iconPath, sizes: "128x128", type: "image/png", purpose: "any" }],
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

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    btn.disabled = true;
    say("Este navegador não suporta notificação push. Em iPhone, adicione o app à tela de início primeiro.");
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

  btn.addEventListener("click", function () {
    btn.disabled = true;
    say("Pedindo permissão...");

    Notification.requestPermission()
      .then(function (permission) {
        if (permission !== "granted") throw new Error("Permissão de notificação negada no navegador.");
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
        say("Não deu: " + err.message);
      });
  });
})();
</script>`;
}
