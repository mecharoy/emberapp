// Elytra web: keeps the app itself available offline. The journal is not here
// (it is in IndexedDB, src/web/sql.ts); this only caches the files the page is
// made of. Written into the build by vite.web.config.ts, which fills in the
// file list and a version that changes whenever any file does.

const CACHE = "elytra-__VERSION__";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("elytra-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only this site's own files. AI requests and the film go straight out.
  if (url.origin !== self.location.origin || url.pathname.endsWith(".mp4")) return;

  if (req.mode === "navigate") {
    // The page: fresh when online, the cached copy when not.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./", copy));
          return res;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }
  // Built files carry a hash in their name, so a cached one never goes stale.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
