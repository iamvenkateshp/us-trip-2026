/* Offline support for the trip app.
 *
 * CACHE-FIRST, deliberately.
 *
 * An earlier version used network-first, which is wrong here for two reasons:
 *   1. On a flaky connection — hotel wifi, a train, a car park with one bar —
 *      the fetch hangs before falling back, so the app feels broken exactly
 *      when it is needed most.
 *   2. A captive portal (the "agree to our terms" page hotels put in front of
 *      their wifi) returns HTTP 200 for any URL. Network-first would happily
 *      cache that login page ON TOP of the app.
 *
 * So: serve from cache immediately, then quietly refresh in the background.
 * Instant load every time, and changes are picked up on the next open.
 */
const CACHE = "trip-v4";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(hit => {
      const live = fetch(req).then(res => {
        // cache only a genuine same-origin success — never a captive portal
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || live;
    })
  );
});

/* Lets the page force an update when it knows it has a real connection. */
self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
