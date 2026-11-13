/*
  zones.js – Zonen auf einer Feldhälfte (reine Funktionen, wie rules.js).

  Raster laut Bewertungsgrundlage: 9 Hauptzonen (1–9), jede in 4 Unterzonen
  A–D geteilt = 36 Felder. Gezeichnet mit dem Netz OBEN, gesehen von hinter
  dem Team (links = Position 4):

      Netz
    C4 B4 | C3 B3 | C2 B2
    D4 A4 | D3 A3 | D2 A2
    ------+-------+------
    C7 B7 | C8 B8 | C9 B9
    D7 A7 | D8 A8 | D9 A9
    ------+-------+------
    C5 B5 | C6 B6 | C1 B1
    D5 A5 | D6 A6 | D1 A1

  Zwei Arten von Zonen:
  - "target" (Aufschlag, Angriff): wohin der Ball beim GEGNER geht.
      grob: Hauptzone "1"–"9"     fein: Unterzone "C4", "A1", ...
  - "pass" (Annahme, Abwehr): wo der Ball auf der EIGENEN Seite ankommt.
      grob: Farbzone "P#", "P+", "P!", "P-" (grün, gelb, orange, rosa)
      fein: Unterzone wie oben; die Farbzone ergibt sich daraus.
  Dazu immer "out" = AUS. Gespeichert wird, was angetippt wurde: im feinen
  Raster die Unterzone, im groben die Hauptzone bzw. Farbzone. Die grobe Zone
  lässt sich aus der feinen immer ausrechnen (coarseZone).
*/

export const OUT = "out";

// Die 6 Reihen (Netz oben), je 6 Felder.
export const ZONE_ROWS = [
  ["C4", "B4", "C3", "B3", "C2", "B2"],
  ["D4", "A4", "D3", "A3", "D2", "A2"],
  ["C7", "B7", "C8", "B8", "C9", "B9"],
  ["D7", "A7", "D8", "A8", "D9", "A9"],
  ["C5", "B5", "C6", "B6", "C1", "B1"],
  ["D5", "A5", "D6", "A6", "D1", "A1"],
];

export const CELLS = ZONE_ROWS.flat();

// Farbzonen für Annahme/Abwehr (gleiche Anordnung wie ZONE_ROWS), laut Bewertungsgrundlage.
const PASS_BAND_ROWS = [
  ["!", "+", "+", "#", "#", "+"],
  ["!", "!", "+", "+", "+", "+"],
  ["!", "!", "!", "!", "!", "!"],
  ["-", "-", "-", "-", "-", "-"],
  ["-", "-", "-", "-", "-", "-"],
  ["-", "-", "-", "-", "-", "-"],
];

export const PASS_BANDS = ["#", "+", "!", "-"]; // grün, gelb, orange, rosa (AUS = dunkelrot)

// Name der Farbzone für Sprachdateien ("zone.band.<name>") und CSS-Klassen ("band-<name>").
export const BAND_NAMES = { "#": "green", "+": "yellow", "!": "orange", "-": "pink" };

// Welche Art von Zone hat eine Aktion? null = keine Zone.
export function zoneKind(action) {
  if (action === "serve" || action === "attack") return "target";
  if (action === "reception" || action === "dig") return "pass";
  return null;
}

/*
  Soll nach dieser Berührung die Zone abgefragt werden?
  Nicht, wenn der Ball gar nicht ankommt bzw. kein Ziel hat:
  Annahme/Abwehr "=" (nicht angenommen) oder "/" (direkt zum Gegner),
  Angriff "/" (geblockt) oder "=" (Fehler: Aus oder Netz – Nutzerwunsch 13.11.2026).
*/
export function zoneAsked(action, quality) {
  const kind = zoneKind(action);
  if (!kind) return false;
  if (kind === "pass" && (quality === "=" || quality === "/")) return false;
  if (action === "attack" && (quality === "/" || quality === "=")) return false; // geblockt oder Fehler
  // Aufschlagfehler (Aus/Netz): keine Zone – das Ziel hat keinen AUS-Rand (Nutzerwunsch 13.11.2026)
  if (action === "serve" && quality === "=") return false;
  return true;
}

// Hauptzone einer Unterzone, z. B. "C4" -> "4"
export function mainZone(cell) {
  return cell.slice(1);
}

// Farbzone einer Unterzone, z. B. "B3" -> "#"
export function passBand(cell) {
  for (let r = 0; r < 6; r++) {
    const c = ZONE_ROWS[r].indexOf(cell);
    if (c >= 0) return PASS_BAND_ROWS[r][c];
  }
  return null;
}

/*
  Grobe Zone zu einem gespeicherten Wert:
    target: "C4" -> "4",  "4" -> "4"
    pass:   "B3" -> "P#", "P+" -> "P+"
    "out" bleibt "out"
*/
export function coarseZone(zone, kind) {
  if (zone === OUT) return OUT;
  if (CELLS.includes(zone)) return kind === "pass" ? `P${passBand(zone)}` : mainZone(zone);
  return zone;
}

// Alle erlaubten Werte für eine Art von Zone.
export function validZones(kind) {
  const coarse = kind === "pass"
    ? PASS_BANDS.map((b) => `P${b}`)
    : ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return [...CELLS, ...coarse, OUT];
}

/*
  Prüft die Zone einer Berührung. Keine Zone (null/undefined) ist immer erlaubt.
  Gibt einen Fehlercode zurück oder null.
*/
export function zoneError(action, zone) {
  if (zone === null || zone === undefined) return null;
  const kind = zoneKind(action);
  if (!kind) return "zoneNotAllowed";
  return validZones(kind).includes(zone) ? null : "zoneInvalid";
}
