/*
  ratings.js – feste Definitionen für Aktionen und Bewertungsstufen.

  Hier steht EINMAL, welche Aktionen und Stufen es gibt. Alle anderen Dateien
  lesen nur von hier. Willst du später ein App-Symbol ändern, änderst du es
  nur in dieser Datei.

  code   = Standardcode laut Bewertungsgrundlage (wird gespeichert und exportiert)
  id     = interner Name (für Sprachdateien: "quality.<id>")
  symbol = Anzeige in der App (frei änderbar)
  color  = CSS-Variable aus style.css
*/

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
