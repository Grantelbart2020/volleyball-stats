/*
  formation.js – Laufwege: Wo steht jemand TATSÄCHLICH auf dem Feld?
  Reine Funktionen (kein DOM, keine Datenbank), getestet in tests/formation.test.mjs.

  Die Regeln (Rotation, Aufschläger, Libero, vorne/hinten) rechnen weiter mit
  der offiziellen Aufstellung. Hier wird nur berechnet, welche Person auf
  welchem der 6 Felder ANGEZEIGT wird (und an der Berührung gespeichert).

  Aufstellung wie in rules.js: lineup[0] = Position 1 … lineup[5] = Position 6.
  Ergebnis in derselben Form: fields[0] = wer auf Feld 1 steht usw.
*/

/*
  Phase im Ballwechsel (für ein Team):
    "base"    eigener Aufschlag steht bevor -> offizielle Aufstellung
    "receive" Gegner schlägt auf, noch keine eigene Berührung -> Annahme-Formation
    "play"    nach der ersten eigenen Berührung (auch dem eigenen Aufschlag) -> Spielposition
  Neuer Ballwechsel (rally leer) = wieder von vorn.
*/
export function formationPhase(rally, team, serving) {
  if (rally.some((touch) => touch.team === team)) return "play";
  return serving === team ? "base" : "receive";
}

export function courtFields(lineup, roleOf, phase) {
  if (phase === "receive") return reception(lineup, roleOf) ?? lineup;
  if (phase === "play") return play(lineup, roleOf);
  return lineup;
}

/*
  Spielposition (Nutzerfestlegung 26.11.2026), getrennt für vorne und hinten:
    vorne:  Außen links (4), Mitte Mitte (3), Zuspieler/Diagonal rechts (2)
    hinten: Mitte/Libero links (5), Außen Mitte (6), Zuspieler/Diagonal rechts (1)
  Passt eine Reihe nicht (Position fehlt, zwei Außen vorne …), bleibt diese
  Reihe offiziell.
*/
const PLAY_ROWS = [
  [[2, 3, 4], { outside: 4, middle: 3, setter: 2, opposite: 2 }],
  [[1, 6, 5], { middle: 5, libero: 5, outside: 6, setter: 1, opposite: 1 }],
];

function play(lineup, roleOf) {
  const fields = [...lineup];
  for (const [positions, target] of PLAY_ROWS) {
    const goals = positions.map((pos) => target[roleOf(lineup[pos - 1])]);
    if (goals.includes(undefined) || new Set(goals).size !== 3) continue;
    positions.forEach((pos, i) => { fields[goals[i] - 1] = lineup[pos - 1]; });
  }
  return fields;
}

/*
  Annahme-Formation (Nutzerfestlegung 26.11.2026), 5-1 mit Libero.
  Reihenfolge der Rotation ab dem Zuspieler: Z, A1, M1, D, A2, M2
  (Abstand 0 … 5). Die hintere Mitte ist der Libero.
  RECEPTION[Position des Zuspielers] = Abstand zum Zuspieler für die Felder
  in der Reihenfolge FIELDS (vorne 4 3 2, hinten 5 6 1):
    1 (Z auf 1)  D  | M1 | Z    A2 | L  | A1
    2 (Z auf 6)  D  | Z  | M1   A2 | L  | A1
    3 (Z auf 5)  M2 | Z  | D    A2 | A1 | L
    4 (Z auf 4)  Z  | M2 | D    A1 | L  | A2
    5 (Z auf 3)  D  | Z  | M2   A1 | L  | A2
    6 (Z auf 2)  D  | M1 | Z    A1 | A2 | L
  Passt die Aufstellung nicht zu diesem Muster -> offizielle Aufstellung.
*/
const FIELDS = [4, 3, 2, 5, 6, 1];
const PATTERN = ["setter", "outside", "middle", "opposite", "outside", "middle"];
const RECEPTION = {
  1: [3, 2, 0, 4, 5, 1],
  6: [3, 0, 2, 4, 5, 1],
  5: [5, 0, 3, 4, 1, 2],
  4: [0, 5, 3, 1, 2, 4],
  3: [3, 0, 5, 1, 2, 4],
  2: [3, 2, 0, 1, 4, 5],
};

function reception(lineup, roleOf) {
  const setters = [0, 1, 2, 3, 4, 5].filter((i) => roleOf(lineup[i]) === "setter");
  if (setters.length !== 1) return null;
  const s = setters[0];
  const at = (offset) => lineup[(s + offset) % 6];
  const fits = PATTERN.every((want, offset) => {
    const role = roleOf(at(offset));
    return role === want || (want === "middle" && role === "libero");
  });
  if (!fits) return null;
  const fields = new Array(6);
  RECEPTION[s + 1].forEach((offset, i) => { fields[FIELDS[i] - 1] = at(offset); });
  return fields;
}
