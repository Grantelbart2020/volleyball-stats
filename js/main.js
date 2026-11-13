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
import { readSetting, saveSetting } from "./settings.js";
import { renderTeams } from "./screen-teams.js";
import { renderTeam } from "./screen-team.js";
import { renderMatchForm } from "./screen-match-form.js";
import { renderMatch } from "./screen-match.js";
import { renderReport } from "./screen-report.js";
import { renderSettings } from "./screen-settings.js";
import { renderRadialTest } from "./radial-test.js";

// Namen, unter denen die Einstellungen im Browser gespeichert werden.
// (Hinweis: Hier liegen nur Einstellungen. Die Daten liegen in der Datenbank, db.js.)
const STORAGE_KEY_LANGUAGE = "vbstats.language";
const STORAGE_KEY_THEME = "vbstats.theme";

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
    #/team/<id>     -> ein Team mit Kader und Spielen
    #/team/<id>/match/new -> neues Spiel anlegen
    #/match/<id>    -> ein Spiel (Kader, Satz starten, Spielstand)
    #/match/<id>/edit -> Spielangaben ändern
    #/match/<id>/report -> Spielbericht (zum Drucken als PDF)
    #/settings      -> Einstellungen
    #/test          -> Kreismenü-Test
  Vorteil: Der Zurück-Knopf des Browsers bzw. Handys funktioniert ganz normal.

  /^...$/.exec(hash) prüft die Adresse mit einem "regulären Ausdruck" (wie re.match
  in Python). ([\w-]+) fängt die id ein, sie steht danach in route[1].
*/
const app = document.getElementById("app");

async function renderRoute() {
  const hash = location.hash || "#/";
  let route;
  try {
    if ((route = /^#\/team\/([\w-]+)$/.exec(hash))) {
      await renderTeam(app, route[1]);
    } else if ((route = /^#\/team\/([\w-]+)\/match\/new$/.exec(hash))) {
      await renderMatchForm(app, { teamId: route[1] });
    } else if ((route = /^#\/match\/([\w-]+)\/edit$/.exec(hash))) {
      await renderMatchForm(app, { matchId: route[1] });
    } else if ((route = /^#\/match\/([\w-]+)\/report$/.exec(hash))) {
      await renderReport(app, route[1]);
    } else if ((route = /^#\/match\/([\w-]+)$/.exec(hash))) {
      await renderMatch(app, route[1]);
    } else if (hash === "#/settings") {
      renderSettings(app);
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
