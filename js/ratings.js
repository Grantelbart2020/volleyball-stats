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

// Die 6 Ränge (Reihenfolge = wie gut). Symbol/Farbe hier nur noch für Legenden
// im Bericht; die Anzeige pro Aktion liefert qualityDisplay (siehe unten).
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
  Stufen, die das Kreismenü für eine Aktion anbietet (Nutzerfestlegung 13.11.2026):
  Beim Block entfällt "/" (Übertritt/Netz werden über die Punktgründe erfasst).
  Ältere Block-Berührungen mit "/" bleiben gültig und zählen in der Auswertung
  weiter (dort gilt codesFor).
*/
export function menuCodes(action) {
  const codes = codesFor(action);
  return action === "block" ? codes.filter((code) => code !== "/") : codes;
}

/*
  Aussehen einer Bewertung pro Aktion (Nutzerfestlegung 13.11.2026), damit
  auch Neue verstehen, was gemeint ist:
    Punkt (Ass / #)  dunkelgrün       ++  grün        +  hellgrün
    =  gelb (mittel)   −  orange      ✖  grau (Fehler)
    Freeball / rüber / geblockt (✋)  blau – der Ball geht zum Gegner
  Ergebnis: { code, id, color, text, key }
    text = sprachneutrales Zeichen ("++", "✖" …) ODER
    key  = Schlüssel in den Sprachdateien ("look.ace" …) für Wörter
    id   = Name des Codes, für den langen Text "quality.<aktion>.<id>"
*/
const COLORS = {
  point: "var(--q-point)", plus2: "var(--q-plus2)", plus: "var(--q-plus)",
  mid: "var(--q-mid)", minus: "var(--q-minus)", over: "var(--q-over)", error: "var(--q-error)",
};

function look(code, action) {
  switch (code) {
    case "#":
      if (action === "serve") return { key: "look.ace", color: COLORS.point };
      if (action === "attack" || action === "block") return { text: "#", color: COLORS.point };
      return { text: "++", color: COLORS.plus2 };
    case "/":
      if (action === "serve") return { text: "++", color: COLORS.plus2 };
      if (action === "reception") return { key: "look.freeballOver", color: COLORS.over };
      if (action === "set") return { key: "look.over", color: COLORS.over };
      if (action === "attack") return { text: "✋", color: COLORS.over }; // geblockt
      if (action === "block") return { text: "/", color: COLORS.over };  // nur alte Daten
      return { key: "look.freeball", color: COLORS.over };              // Abwehr, Freeball
    case "+": return { text: "+", color: COLORS.plus };
    case "!": return { text: "=", color: COLORS.mid };
    case "-": return { text: "−", color: COLORS.minus };
    default:  return { text: "✖", color: COLORS.error };              // "=" Fehler
  }
}

export function qualityDisplay(code, action) {
  if (!codesFor(action).includes(code)) return null;
  const byCode = QUALITIES.find((q) => q.code === code);
  return { code, id: byCode.id, ...look(code, action) };
}
