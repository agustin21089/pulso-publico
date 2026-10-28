const CACHE = "pulso-1b1e2f6d-68dac8197541";
const CACHE_SCOPE = "pulso-1b1e2f6d-";
const DATA_ORIGIN = null;
const base = new URL(self.registration.scope);
const local = (path) => new URL(path, base).href;
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const response = await fetch(local("precache.json"));
      if (!response.ok) throw Error("No precache manifest");
      await cache.addAll(await response.json());
    }),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_SCOPE) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  const own = u.origin === base.origin && u.pathname.startsWith(base.pathname);
  const relative = own ? u.pathname.slice(base.pathname.length) : "";
  const externalData =
    DATA_ORIGIN &&
    u.href.startsWith(DATA_ORIGIN) &&
    /^(data\/current\.json|data\/snapshots\/[a-f0-9]{16}\/)/.test(
      u.href.slice(DATA_ORIGIN.length),
    );
  if (
    event.request.method !== "GET" ||
    !(
      externalData ||
      (own &&
        (/^(assets|data\/snapshots|data\/geo)\//.test(relative) ||
          [
            "",
            "index.html",
            "data/current.json",
            "icon.svg",
            "manifest.webmanifest",
            "runtime.json",
          ].includes(relative)))
    )
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(
        async () =>
          (await (
            await caches.open(CACHE)
          ).match(event.request, { ignoreVary: true })) ??
          (event.request.mode === "navigate"
            ? await (
                await caches.open(CACHE)
              ).match(local(""), { ignoreVary: true })
            : null) ??
          Response.error(),
      ),
  );
});
