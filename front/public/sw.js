self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("futsi-shell-v1").then((cache) => cache.addAll(["./", "./manifest.webmanifest", "./icon.svg"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).pathname.includes("/api/")) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).catch(() => caches.match("./"))),
  );
});
