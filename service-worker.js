/*
  service-worker.js – macht die App offline-fähig.

  Ein Service Worker ist ein kleines Programm, das der Browser im Hintergrund
  für unsere Seite laufen lässt. Er steht zwischen App und Netz:
  Jede Anfrage nach einer Datei (HTML, CSS, JS, Bilder) geht zuerst an ihn.

  Unsere Strategie ("stale-while-revalidate"):
  1. Beim Installieren werden alle App-Dateien in einen Speicher (Cache) gelegt.
  2. Fragt die App eine Datei an, kommt sie SOFORT aus dem Cache -> läuft ohne Netz.
  3. Gibt es Netz, holt der Service Worker im Hintergrund die neueste Version
     und legt sie in den Cache. Beim NÄCHSTEN Start ist dann die neue Version da.

  Wichtig: Der Service Worker speichert nur die App selbst, NICHT deine Spieldaten.
  Die kommen später in die Datenbank (db.js).

  Neue Datei im Projekt?  -> in APP_FILES eintragen.
  Größere Umbauten?       -> CACHE_VERSION um 1 erhöhen, dann wird alles frisch geladen.
*/

const CACHE_VERSION = 5;
const CACHE_NAME = `vbstats-v${CACHE_VERSION}`;

// Alle Dateien, die die App zum Laufen braucht (Pfade relativ zu diesem Skript).
const APP_FILES = [
  "./",
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/main.js",
  "js/i18n.js",
  "js/ratings.js",
  "js/radial-menu.js",
  "js/radial-test.js",
  "js/db.js",
  "js/dom.js",
  "js/screen-teams.js",
  "js/screen-team.js",
  "js/rules.js",
  "js/settings.js",
  "js/match-format.js",
  "js/match-live.js",
  "js/screen-match.js",
  "js/screen-match-form.js",
  "js/screen-settings.js",
  "js/zones.js",
  "js/zone-picker.js",
  "i18n/de.json",
  "i18n/en.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon.png",
];

// 1. Installieren: alle App-Dateien in den Cache laden.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES))
  );
  self.skipWaiting(); // neue Version sofort aktivieren statt zu warten
});

// 2. Aktivieren: Caches alter Versionen löschen.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith("vbstats-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim(); // offene Seiten sofort übernehmen
});

// 3. Jede Anfrage: aus dem Cache antworten, im Hintergrund aktualisieren.
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Nur normale Abrufe der eigenen Seite behandeln, alles andere direkt ans Netz.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // ignoreSearch: "index.html?x=1" findet trotzdem "index.html"
      const cached = await cache.match(request, { ignoreSearch: true });

      // Im Hintergrund die neueste Version holen (scheitert ohne Netz still).
      const fromNetwork = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);

      // Aus dem Cache, falls vorhanden, sonst aus dem Netz.
      return cached ?? (await fromNetwork) ?? Response.error();
    })
  );
});
