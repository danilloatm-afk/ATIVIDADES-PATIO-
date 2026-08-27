// Service Worker do app shell. Cuida só dos arquivos estáticos (HTML/CSS/JS/
// ícones) para o app abrir instantaneamente e funcionar offline mesmo com o
// navegador fechado antes. NÃO mexe com as chamadas ao Supabase (dados) —
// essas continuam passando direto pela rede.
//
// IMPORTANTE: sempre que qualquer arquivo estático mudar (index.html,
// style.css, app.js, manifest.json, ícones), aumente o CACHE_VERSION abaixo.
// Sem isso o navegador de quem já instalou o app continua servindo os
// arquivos antigos do cache indefinidamente.
const CACHE_VERSION = "v25";
const CACHE_NAME = `op-shell-${CACHE_VERSION}`;

const ARQUIVOS_PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "avaliar.html",
  "avaliar.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "https://unpkg.com/@supabase/supabase-js@2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function ehChamadaDeApi(url) {
  return url.hostname.endsWith("supabase.co");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Chamadas ao Supabase (dados) sempre vão direto pra rede, sem cache.
  if (ehChamadaDeApi(url)) return;

  // Recursos de outros sites (ex: imagem do QR code) vão direto pra rede,
  // sem entrar no cache do app shell — eles mudam por setor/link e não faz
  // sentido guardar no cache do app.
  if (url.origin !== self.location.origin) return;

  // HTML/CSS/JS do app: tenta a rede primeiro (pra sempre pegar a versão
  // mais nova quando online), e só cai pro cache se estiver sem conexão.
  // cache: "no-store" é essencial aqui — sem isso o fetch() de dentro do
  // service worker pode ser respondido pelo cache HTTP comum do navegador
  // (não o nosso CACHE_NAME), servindo uma versão desatualizada mesmo com
  // o service worker já rodando a versão nova.
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return resposta;
      })
      .catch(() => caches.match(event.request))
  );
});
