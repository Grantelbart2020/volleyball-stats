/*
  main.js – Startpunkt der App.

  Aufgaben:
  - gespeicherte Einstellungen (Sprache, Design) laden
  - die beiden Schalter in der Kopfzeile verbinden
  - zwischen den Bildschirmen wechseln ("Router", siehe unten)
  - dauerhafte Speicherung anfragen und den Service Worker anmelden

  "import" holt Funktionen aus einer anderen Datei (wie "from x import y" in Python).
*/
import { loadLanguage, applyTranslations, getLanguage, t } from "./i18n.js";
import { el } from "./dom.js";
import { requestPersistentStorage } from "./db.js";
import { renderTeams } from "./screen-teams.js";
import { renderTeam } from "./screen-team.js";
import { renderRadialTest } from "./radial-test.js";

// Namen, unter denen die Einstellungen im Browser gespeichert werden.
const STORAGE_KEY_LANGUAGE = "vbstats.language";
const STORAGE_KEY_THEME = "vbstats.theme";

/*
  Kleine Hilfsfunktionen für localStorage (ein einfacher Schlüssel-Wert-Speicher
  im Browser). Er kann in seltenen Fällen fehlen oder blockiert sein –
  try/catch fängt das ab, damit die App trotzdem läuft.
  Hinweis: Hier liegen nur Einstellungen. Die Daten liegen in der Datenbank (db.js).
*/
function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Speichern nicht möglich – Einstellung gilt dann nur bis zum Neuladen.
  }
}

/* ---------- Design (hell/dunkel) ---------- */

function applyTheme(theme) {
  // Setzt data-theme am <html>-Element; style.css wählt daraufhin die Farben.
  document.documentElement.dataset.theme = theme;

  // Der Knopf zeigt das Design, zu dem man WECHSELN kann.
  const themeButton = document.getElementById("btn-theme");
  themeButton.dataset.i18n = theme === "dark" ? "settings.themeLight" : "settings.themeDark";
}

/* ---------- Router: welcher Bildschirm wird gezeigt? ---------- */

/*
  Der Bildschirm steht im Teil der Adresse nach dem "#":
    #/              -> Teamliste
    #/team/<id>     -> ein Team mit Kader
    #/test          -> Kreismenü-Test
  Vorteil: Der Zurück-Knopf des Browsers bzw. Handys funktioniert ganz normal.
*/
const app = document.getElementById("app");

async function renderRoute() {
  const hash = location.hash || "#/";
  try {
    const teamMatch = /^#\/team\/([\w-]+)$/.exec(hash);
    if (teamMatch) {
      await renderTeam(app, teamMatch[1]);
    } else if (hash === "#/test") {
      renderRadialTest(app);
    } else {
      await renderTeams(app);
    }
  } catch (error) {
    // Fehler sichtbar machen statt einer leeren Seite
    console.error("Fehler beim Anzeigen des Bildschirms:", error);
    app.replaceChildren(
      el("section", { class: "card" },
        el("p", { class: "form-error" }, t("error.generic")),
        el("a", { class: "btn", href: "#/" }, t("nav.teams")),
      ),
    );
  }
}

/* ---------- Start der App ---------- */

async function start() {
  // 1. Sprache: gespeicherte Wahl, sonst Gerätesprache, sonst Deutsch.
  const deviceLanguage = navigator.language.slice(0, 2); // "de-DE" -> "de"
  const language = readSetting(STORAGE_KEY_LANGUAGE) ?? deviceLanguage;

  // 2. Design: gespeicherte Wahl, sonst dunkel (Standard laut Konzept).
  const theme = readSetting(STORAGE_KEY_THEME) ?? "dark";

  applyTheme(theme);
  await loadLanguage(language);
  applyTranslations();

  // 3. Ersten Bildschirm zeigen und bei jeder Adressänderung neu zeichnen.
  window.addEventListener("hashchange", () => {
    renderRoute();
    window.scrollTo(0, 0);
  });
  await renderRoute();

  // 4. Sprach-Knopf: zwischen de und en wechseln.
  document.getElementById("btn-language").addEventListener("click", async () => {
    const newLanguage = getLanguage() === "de" ? "en" : "de";
    await loadLanguage(newLanguage);
    saveSetting(STORAGE_KEY_LANGUAGE, newLanguage);
    applyTranslations();
    renderRoute(); // aktuellen Bildschirm in der neuen Sprache zeichnen
  });

  // 5. Design-Knopf: zwischen dark und light wechseln.
  document.getElementById("btn-theme").addEventListener("click", () => {
    const newTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(newTheme);
    saveSetting(STORAGE_KEY_THEME, newTheme);
    applyTranslations(); // Knopftext an das neue Design anpassen
  });

  // 6. Browser bitten, die Daten dauerhaft zu behalten (Ergebnis steht in der Konsole).
  requestPersistentStorage()
    .then((granted) => console.info("Dauerhafte Speicherung:", granted ? "ja" : "nein"))
    .catch(() => {});
}

/* ---------- Offline-Fähigkeit (Service Worker) ---------- */

/*
  Den Service Worker nur auf der echten Adresse (GitHub Pages, https) anmelden,
  NICHT beim Entwickeln mit Live Server. Sonst würde er alte Dateien aus dem
  Cache zeigen und deine Änderungen wären erst nach dem zweiten Neuladen sichtbar.
*/
function registerServiceWorker() {
  const isDevelopment = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!("serviceWorker" in navigator) || isDevelopment || location.protocol !== "https:") {
    return;
  }
  navigator.serviceWorker.register("service-worker.js").catch((error) => {
    console.error("Service Worker konnte nicht angemeldet werden:", error);
  });
}

registerServiceWorker();

// start() aufrufen. Geht etwas schief, steht der Fehler in der Browser-Konsole (F12).
start().catch((error) => {
  console.error("Fehler beim Start der App:", error);
});
