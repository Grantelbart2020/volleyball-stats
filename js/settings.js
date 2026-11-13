/*
  settings.js – Einstellungen der App (gelten für alle Spiele auf diesem Gerät).

  Gespeichert im localStorage des Browsers (einfacher Schlüssel-Wert-Speicher),
  nicht in der Datenbank. Dort liegen nur Daten wie Teams und Spiele.

  Inhalt:
    opponentMode  "players" = Gegnerspieler einzeln erfassen (Standard)
                  "team"    = nur die Gegner-Mannschaft insgesamt
    zoneMode      "coarse" = grobe Zonen (Standard): Hauptzonen 1–9 bzw. Farbzonen
                  "fine"   = feines Raster: 36 Unterzonen (siehe zones.js)
    rules         Standard-Regelwerte für neue Spiele (siehe rules.js)
*/
import { defaultRules } from "./rules.js";

const STORAGE_KEY_SETTINGS = "vbstats.settings";

/*
  localStorage kann in seltenen Fällen fehlen oder blockiert sein –
  try/catch fängt das ab, damit die App trotzdem läuft.
*/
export function readSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Speichern nicht möglich – Einstellung gilt dann nur bis zum Neuladen.
  }
}

// Liefert die Einstellungen; fehlende Werte werden mit Standardwerten ergänzt.
export function getSettings() {
  let stored = {};
  try {
    stored = JSON.parse(readSetting(STORAGE_KEY_SETTINGS) ?? "{}") ?? {};
  } catch {
    stored = {}; // kaputter Eintrag -> Standardwerte
  }
  return {
    opponentMode: stored.opponentMode === "team" ? "team" : "players",
    zoneMode: stored.zoneMode === "fine" ? "fine" : "coarse",
    rules: { ...defaultRules(), ...stored.rules },
  };
}

export function saveSettings(settings) {
  saveSetting(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
}
