/*
  main.js – Startpunkt der App.

  Aufgaben in Meilenstein 0:
  - gespeicherte Einstellungen (Sprache, Design) laden
  - die beiden Schalter in der Kopfzeile verbinden

  "import" holt Funktionen aus einer anderen Datei (wie "from x import y" in Python).
*/
import { loadLanguage, applyTranslations, getLanguage } from "./i18n.js";
import { initRadialTest, refreshRadialTestTexts } from "./radial-test.js";

// Namen, unter denen die Einstellungen im Browser gespeichert werden.
const STORAGE_KEY_LANGUAGE = "vbstats.language";
const STORAGE_KEY_THEME = "vbstats.theme";

/*
  Kleine Hilfsfunktionen für localStorage (ein einfacher Schlüssel-Wert-Speicher
  im Browser). Er kann in seltenen Fällen fehlen oder blockiert sein –
  try/catch fängt das ab, damit die App trotzdem läuft.
  Hinweis: Die Spieldaten kommen später NICHT hierhin, sondern in die Datenbank (db.js).
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

  // Meilenstein 1a: Testbildschirm mit Kreismenü aufbauen
  initRadialTest();

  // 3. Sprach-Knopf: zwischen de und en wechseln.
  document.getElementById("btn-language").addEventListener("click", async () => {
    const newLanguage = getLanguage() === "de" ? "en" : "de";
    await loadLanguage(newLanguage);
    saveSetting(STORAGE_KEY_LANGUAGE, newLanguage);
    applyTranslations();
    refreshRadialTestTexts(); // Eingabeliste in neuer Sprache
  });

  // 4. Design-Knopf: zwischen dark und light wechseln.
  document.getElementById("btn-theme").addEventListener("click", () => {
    const newTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(newTheme);
    saveSetting(STORAGE_KEY_THEME, newTheme);
    applyTranslations(); // Knopftext an das neue Design anpassen
  });
}

// start() aufrufen. Geht etwas schief, steht der Fehler in der Browser-Konsole (F12).
start().catch((error) => {
  console.error("Fehler beim Start der App:", error);
});
