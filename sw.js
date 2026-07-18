// Health Coach service worker — app-shell caching only.
// Data (Supabase / Claude / Google Health / OAuth) is ALWAYS network-only:
// the app must never show stale data.
// CACHE_VERSION is rewritten by build.py on every build so old caches purge
// and new code takes effect without manual cache clears.
const CACHE_VERSION = "hc-20260718-094329"; // <-- build.py stamps this
const SHELL_CACHE = "shell-" + CACHE_VERSION;

// Relative paths — the app lives under /health-dashboard/ on GitHub Pages
// and the SW's own directory defines its scope.
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
];

// Hosts that must NEVER be cached — live data, AI, auth/tokens, analytics.
const NETWORK_ONLY_HOSTS = [
  "itdrrugsztpqkafxfljt.supabase.co",
  "api.anthropic.com",
  "health.googleapis.com",
  "www.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
  "www.google-analytics.com",
  "www.googletagmanager.com",
];

// Static asset hosts safe to cache-first at runtime (fonts).
const RUNTIME_CACHE_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Add individually so one flaky CDN fetch doesn't fail the whole install
      Promise.allSettled(PRECACHE.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST/PATCH/DELETE pass straight through
  const url = new URL(req.url);

  // Live data & auth: bypass the cache entirely.
  if (NETWORK_ONLY_HOSTS.includes(url.host)) return;

  // Navigations: NETWORK-FIRST so a fresh deploy loads immediately; fall back to
  // the cached shell only when offline. (Cache-first left the installed app a
  // version behind until the next relaunch.)
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("./index.html", copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Shell + fonts/CDN static assets: cache-first with runtime population.
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin || RUNTIME_CACHE_HOSTS.includes(url.host)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
  }
  // Anything else: default network behaviour.
});
