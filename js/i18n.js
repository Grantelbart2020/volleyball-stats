/*
  i18n.js – Übersetzungen (i18n ist die übliche Abkürzung für "internationalization":
  i + 18 Buchstaben + n).

  So funktioniert es:
  1. loadLanguage("de") lädt die Datei i18n/de.json.
  2. Darin stehen Paare wie  "home.welcome": "Willkommen".
  3. applyTranslations() sucht alle HTML-Elemente mit data-i18n="home.welcome"
     und setzt den passenden Text ein.

  Vergleich zu Python: "translations" ist hier wie ein Python-Dictionary.
*/

// Welche Sprachen es gibt. Eine neue Sprache = neue JSON-Datei + Eintrag hier.
export const SUPPORTED_LANGUAGES = ["de", "en"];

// Die aktuell geladenen Texte (am Anfang leer).
let translations = {};

// Die aktuelle Sprache.
let currentLanguage = "de";

/*
  Lädt eine Sprachdatei.
  "async" bedeutet: Die Funktion wartet auf etwas (hier: das Laden der Datei),
  ohne dass die ganze App einfriert. Mit "await" wird auf das Ergebnis gewartet.
*/
export async function loadLanguage(language) {
  // Unbekannte Sprache? Dann Deutsch nehmen.
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    language = "de";
  }

  const response = await fetch(`i18n/${language}.json`);
  if (!response.ok) {
    // Fehler sichtbar machen statt still zu scheitern.
    throw new Error(`Sprachdatei ${language}.json konnte nicht geladen werden`);
  }

  translations = await response.json();
  currentLanguage = language;

  // Dem Browser die Sprache mitteilen (wichtig z. B. für Screenreader).
  document.documentElement.lang = language;
}

/*
  Gibt den Text zu einem Schlüssel zurück.
  Fehlt ein Text, wird der Schlüssel selbst angezeigt – so fallen fehlende
  Übersetzungen beim Testen sofort auf.
*/
export function t(key) {
  return translations[key] ?? key;
}

// Setzt alle Texte auf der Seite neu.
export function applyTranslations() {
  // querySelectorAll findet alle Elemente, die ein data-i18n-Attribut haben.
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n; // liest data-i18n="..."
    element.textContent = t(key);
  });
}

export function getLanguage() {
  return currentLanguage;
}
