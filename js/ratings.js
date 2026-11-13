/*
  ratings.js – feste Definitionen für Aktionen und Bewertungsstufen.

  Hier steht EINMAL, welche Aktionen und Stufen es gibt. Alle anderen Dateien
  lesen nur von hier. Willst du später ein App-Symbol ändern, änderst du es
  nur in dieser Datei.

  code   = Standardcode laut Bewertungsgrundlage (wird gespeichert und exportiert)
  id     = interner Name (für Sprachdateien: "quality.<aktion>.<id>")
  symbol = Anzeige in der App (frei änderbar)
  color  = CSS-Variable aus style.css

  WICHTIG: Symbol und Farbe zeigen, wie GUT eine Berührung ist (Rang 0 = am
  besten). Bei fast allen Aktionen passt das zur Reihenfolge der Codes
  # + ! - / =. Nur beim Aufschlag ist "/" laut Bewertungsgrundlage
  "sehr positiv" (Annahme des Gegners sehr negativ) und damit das zweitbeste
  Ergebnis. Deshalb gibt es pro Aktion eine Reihenfolge der Codes (CODE_ORDER).
*/

// Die 6 Ränge: Anzeige im Kreismenü, im Ballwechsel und im Verlauf.
export const QUALITIES = [
  { code: "#", id: "perfect",  symbol: "★", color: "var(--q-perfect)" },
  { code: "+", id: "positive", symbol: "+", color: "var(--q-positive)" },
  { code: "!", id: "medium",   symbol: "~", color: "var(--q-medium)" },
  { code: "-", id: "negative", symbol: "−", color: "var(--q-negative)" },
  { code: "/", id: "poor",     symbol: "✖", color: "var(--q-poor)" },
  { code: "=", id: "error",    symbol: "⚠", color: "var(--q-error)" },
];

// Die sieben Aktionen. Der Text dazu steht in den Sprachdateien unter "action.<name>".
export const ACTIONS = ["serve", "reception", "set", "attack", "block", "dig", "freeball"];

// Codes vom besten zum schlechtesten Ergebnis, pro Aktion.
const DEFAULT_ORDER = ["#", "+", "!", "-", "/", "="];
const CODE_ORDER = {
  serve: ["#", "/", "+", "!", "-", "="],
};

// Codes einer Aktion vom besten zum schlechtesten (Segment 0 im Kreismenü = bester).
export function codesFor(action) {
  return CODE_ORDER[action] ?? DEFAULT_ORDER;
}

/*
  Anzeige einer Bewertung für eine Aktion:
  { code, id, symbol, color }
    symbol, color = nach Rang (wie gut)
    id            = Name des Codes, für den Text "quality.<aktion>.<id>"
  Beispiel Aufschlag "/": Symbol "+", hellgrün, Text "Sehr positiv".
*/
export function qualityDisplay(code, action) {
  const rank = codesFor(action).indexOf(code);
  if (rank < 0) return null;
  const byCode = QUALITIES.find((q) => q.code === code);
  return { code, id: byCode.id, symbol: QUALITIES[rank].symbol, color: QUALITIES[rank].color };
}
