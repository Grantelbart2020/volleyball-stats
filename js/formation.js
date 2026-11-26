/*
  formation.js – Laufwege: Wo steht jemand TATSÄCHLICH auf dem Feld?
  Reine Funktionen (kein DOM, keine Datenbank), getestet in tests/formation.test.mjs.

  Die Regeln (Rotation, Aufschläger, Libero, vorne/hinten) rechnen weiter mit
  der offiziellen Aufstellung. Hier wird nur berechnet, welche Person auf
  welchem der 6 Felder ANGEZEIGT wird (und an der Berührung gespeichert).

  Aufstellung wie in rules.js: lineup[0] = Position 1 … lineup[5] = Position 6.
  Ergebnis in derselben Form: fields[0] = wer auf Feld 1 steht usw.

  Laufweg-System (pro Team gespeichert, team.systems):
    { id, name, pattern, receive, play }
    pattern = Grundreihenfolge ab dem Zuspieler, 6 Positionen (Abstand 0 … 5),
              z. B. 5-1: setter outside middle opposite outside middle
    receive / play = { [Rotation]: Tabelle },  Tabelle[Feld - 1] = Abstand
              der Person zum Zuspieler (0 = Zuspieler, 1 = nächster usw.)
  Rotation r: Zuspieler (Abstand 0) steht offiziell auf ANCHOR_POS[r - 1].
  Wiederholt sich das Muster nach 3 Plätzen (4-2), gibt es nur 3 Rotationen;
  dann ist "der Zuspieler" immer der hintere (Nutzerentscheidung, Variante A).
*/
export const ANCHOR_POS = [1, 6, 5, 4, 3, 2];
export const PATTERN_5_1 = ["setter", "outside", "middle", "opposite", "outside", "middle"];
export const PATTERN_ROLES = ["setter", "outside", "middle", "opposite"];
const BACK_ROW = [1, 6, 5];

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

export function rotationCount(pattern) {
  return pattern.every((role, i) => role === pattern[(i + 3) % 6]) ? 3 : 6;
}

// Welche Rotation des Systems ist das? { r, s } (s = Index des Zuspielers) oder null
export function findRotation(lineup, roleOf, pattern) {
  for (let r = 1; r <= rotationCount(pattern); r++) {
    const s = ANCHOR_POS[r - 1] - 1;
    const fits = pattern.every((want, k) => {
      const role = roleOf(lineup[(s + k) % 6]);
      return role === want || (want === "middle" && role === "libero"); // Libero ersetzt die Mitte
    });
    if (fits) return { r, s };
  }
  return null;
}

// Eine Tabelle muss jeden Abstand 0 … 5 genau einmal enthalten (Schutz gegen kaputte Importdaten)
function validTable(table) {
  return Array.isArray(table) && table.length === 6 && [0, 1, 2, 3, 4, 5].every((k) => table.includes(k));
}

// Passt die Aufstellung nicht zum System (Position fehlt …), bleibt alles offiziell.
export function courtFields(lineup, roleOf, phase, system) {
  if (phase === "base" || !system) return lineup;
  const found = findRotation(lineup, roleOf, system.pattern);
  const table = found && system[phase === "receive" ? "receive" : "play"]?.[found.r];
  if (!validTable(table)) return lineup;
  return table.map((k) => lineup[(found.s + k) % 6]);
}

/* ---------- Standardwerte für neue Systeme ---------- */

/*
  Spielposition aus den Positionen (Nutzerfestlegung 26.11.2026), je Reihe:
    vorne:  Außen links (4), Mitte Mitte (3), Zuspieler/Diagonal rechts (2)
    hinten: Mitte/Libero links (5), Außen Mitte (6), Zuspieler/Diagonal rechts (1)
  Passt eine Reihe nicht, bleibt sie offiziell.
*/
const PLAY_ROWS = [
  [[2, 3, 4], { outside: 4, middle: 3, setter: 2, opposite: 2 }],
  [[1, 6, 5], { middle: 5, libero: 5, outside: 6, setter: 1, opposite: 1 }],
];

function playRule(lineup, roleOf) {
  const fields = [...lineup];
  for (const [positions, target] of PLAY_ROWS) {
    const goals = positions.map((pos) => target[roleOf(lineup[pos - 1])]);
    if (goals.includes(undefined) || new Set(goals).size !== 3) continue;
    positions.forEach((pos, i) => { fields[goals[i] - 1] = lineup[pos - 1]; });
  }
  return fields;
}

// Tabelle der Spielposition für Rotation r: "Aufstellung" aus den Abständen selbst
function playTable(pattern, r) {
  const s = ANCHOR_POS[r - 1] - 1;
  const lineup = new Array(6);
  for (let k = 0; k < 6; k++) lineup[(s + k) % 6] = k;
  return playRule(lineup, (k) => pattern[k]);
}

/*
  Annahme 5-1 (Nutzerfestlegung 26.11.2026), Felder vorne 4 3 2, hinten 5 6 1:
    1 (Z auf 1)  D  | M1 | Z    A2 | L  | A1
    2 (Z auf 6)  D  | Z  | M1   A2 | L  | A1
    3 (Z auf 5)  M2 | Z  | D    A2 | A1 | L
    4 (Z auf 4)  Z  | M2 | D    A1 | L  | A2
    5 (Z auf 3)  D  | Z  | M2   A1 | L  | A2
    6 (Z auf 2)  D  | M1 | Z    A1 | A2 | L
  (Z 0, A1 1, M1 2, D 3, A2 4, M2 5)
*/
const FIELDS = [4, 3, 2, 5, 6, 1];
const RECEPTION_5_1 = [
  [3, 2, 0, 4, 5, 1],
  [3, 0, 2, 4, 5, 1],
  [5, 0, 3, 4, 1, 2],
  [0, 5, 3, 1, 2, 4],
  [3, 0, 5, 1, 2, 4],
  [3, 2, 0, 1, 4, 5],
];

function byField(row) {
  const table = new Array(6);
  row.forEach((k, i) => { table[FIELDS[i] - 1] = k; });
  return table;
}

/*
  Neues System: Spielposition aus der Regel oben, Annahme = Spielposition
  (zum Anpassen) – nur beim 5-1-Muster die Annahme-Tabelle des Nutzers.
*/
export function buildSystem(id, name, pattern) {
  const is51 = pattern.every((role, k) => role === PATTERN_5_1[k]);
  const system = { id, name, pattern: [...pattern], receive: {}, play: {} };
  for (let r = 1; r <= rotationCount(pattern); r++) {
    system.play[r] = playTable(pattern, r);
    system.receive[r] = is51 ? byField(RECEPTION_5_1[r - 1]) : [...system.play[r]];
  }
  return system;
}

// Systeme eines Teams; ohne eigene das eingebaute 5-1
export function teamSystems(team) {
  return team?.systems?.length ? team.systems : [buildSystem("5-1", "5-1", PATTERN_5_1)];
}

// System für ein Spiel: gewähltes, sonst Standard des Teams, sonst das erste
export function pickSystem(team, systemId) {
  const systems = teamSystems(team);
  return systems.find((s) => s.id === systemId)
    ?? systems.find((s) => s.id === team?.defaultSystemId)
    ?? systems[0];
}

/*
  Kurznamen der 6 Abstände für Rotation r, z. B. Z A1 M1 D A2 L.
  abbr(role) liefert das Kürzel (aus den Sprachdateien). Gibt es eine Position
  mehrmals, wird nummeriert (A1, A2). Die hintere Mitte ist der Libero.
*/
export function systemLabels(pattern, r, abbr) {
  const s = ANCHOR_POS[r - 1] - 1;
  const seen = {};
  return pattern.map((role, k) => {
    const pos = ((s + k) % 6) + 1;
    seen[role] = (seen[role] ?? 0) + 1; // auch die ersetzte Mitte zählt mit (M1/M2 bleiben fest)
    if (role === "middle" && BACK_ROW.includes(pos)) return abbr("libero");
    const many = pattern.filter((other) => other === role).length > 1;
    return many ? `${abbr(role)}${seen[role]}` : abbr(role);
  });
}

/*
  Tausch im Spiel (Griff ≡): pairs = [[idA, idB], …] der Reihe nach.
  Die beiden Personen tauschen ihre Felder; wer nicht (mehr) auf dem Feld ist,
  wird übersprungen.
*/
export function applySwaps(fields, pairs) {
  const result = [...fields];
  for (const [a, b] of pairs) {
    const ia = result.indexOf(a);
    const ib = result.indexOf(b);
    if (ia < 0 || ib < 0) continue;
    result[ia] = b;
    result[ib] = a;
  }
  return result;
}
