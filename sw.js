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
 *
 * ── THE BUG THIS VERSION FIXES ──────────────────────────────────────────
 * The previous worker had a CONSTANT cache name ("trip-v4"). Because the
 * browser only reinstalls a service worker when sw.js itself changes byte-wise,
 * the worker never reinstalled, the activate handler never purged anything, and
 * — worst of all — nothing ever told the open page that a newer copy had
 * arrived. The result: you'd look at the app and see content one or more
 * publishes out of date, with no indication anything was stale.
 *
 * Now: VERSION is stamped automatically by update-site.ps1 on every publish,
 * so sw.js changes every time, the worker reinstalls, old caches are purged,
 * and the page is told to offer a reload. Nothing here depends on anyone
 * remembering to bump a number by hand.
 * ────────────────────────────────────────────────────────────────────────
 */
const VERSION = "b088a3f3a639";
const CACHE = "trip-" + VERSION;
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // no-store so a fresh install never picks up an HTTP-cached copy
      .then(c => Promise.all(ASSETS.map(u =>
        fetch(u, { cache: "no-store" })
          .then(r => (r && r.ok) ? c.put(u, r) : null)
          .catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then(clients => {
        // Tell every open tab that a newer build is live. The page decides what
        // to do about it — currently it shows a "tap to reload" bar rather than
        // reloading underneath you, which would be rude mid-note.
        clients.forEach(c => c.postMessage({ type: "updated", version: VERSION }));
      })
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(hit => {
      const live = fetch(req, { cache: "no-store" }).then(res => {
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
  if (e.data === "skipWaiting" || (e.data && e.data.type === "skipWaiting")) self.skipWaiting();
});

