// Tests für formation.js (Laufwege). Start: node --test tests/formation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PATTERN_5_1, applySwaps, buildSystem, courtFields, findRotation, formationPhase, pickSystem, rotationCount,
  systemLabels, teamSystems,
} from "../js/formation.js";

const ROLE = {
  Z: "setter", Z1: "setter", Z2: "setter", A1: "outside", A2: "outside", M1: "middle", M2: "middle",
  D: "opposite", L: "libero",
};
const roleOf = (id) => ROLE[id];
const system51 = teamSystems(null)[0];

// Rotation r (1–6): erster Spieler auf 1, 6, 5, 4, 3, 2; die hintere Mitte ist durch L ersetzt
function lineupFor(r, start = ["Z", "A1", "M1", "D", "A2", "M2"]) {
  let lineup = start;
  for (let i = 1; i < r; i++) lineup = [...lineup.slice(1), lineup[0]];
  return lineup.map((id, i) => ([0, 4, 5].includes(i) && id.startsWith("M") ? "L" : id));
}

// Anzeige wie in der Tabelle des Nutzers: vorne 4 3 2 | hinten 5 6 1
const show = (f) => `${[4, 3, 2].map((p) => f[p - 1]).join(" ")} | ${[5, 6, 1].map((p) => f[p - 1]).join(" ")}`;

test("Annahme-Formation 5-1 laut Tabelle des Nutzers", () => {
  const table = [
    "D M1 Z | A2 L A1",
    "D Z M1 | A2 L A1",
    "M2 Z D | A2 A1 L",
    "Z M2 D | A1 L A2",
    "D Z M2 | A1 L A2",
    "D M1 Z | A1 A2 L",
  ];
  table.forEach((row, i) =>
    assert.equal(show(courtFields(lineupFor(i + 1), roleOf, "receive", system51)), row, `Rotation ${i + 1}`));
});

test("Spielposition: vorne A M Z/D, hinten L/M A Z/D", () => {
  assert.equal(show(courtFields(lineupFor(1), roleOf, "play", system51)), "A1 M1 D | L A2 Z");
  assert.equal(show(courtFields(lineupFor(4), roleOf, "play", system51)), "A2 M2 Z | L A1 D");
});

test("Passt die Aufstellung nicht zum System, bleibt sie offiziell", () => {
  const lineup = lineupFor(1);
  const noRole = (id) => (id === "M1" ? null : ROLE[id]);
  assert.deepEqual(courtFields(lineup, noRole, "play", system51), lineup);
  assert.deepEqual(courtFields(lineup, noRole, "receive", system51), lineup);
  assert.deepEqual(courtFields(lineup, roleOf, "receive", null), lineup);
  // kaputte Tabelle (z. B. aus einer Importdatei) -> offiziell
  const broken = { ...system51, receive: { 1: [0, 0, 0, 0, 0, 0] } };
  assert.deepEqual(courtFields(lineup, roleOf, "receive", broken), lineup);
});

test("Phase: Aufschlag, Annahme, nach der ersten eigenen Berührung", () => {
  assert.equal(formationPhase([], "own", "own"), "base");
  assert.equal(formationPhase([], "own", "opp"), "receive");
  assert.equal(formationPhase([{ team: "opp" }], "own", "opp"), "receive");
  assert.equal(formationPhase([{ team: "opp" }, { team: "own" }], "own", "opp"), "play");
  assert.equal(formationPhase([{ team: "own" }], "own", "own"), "play");
  assert.deepEqual(courtFields(lineupFor(2), roleOf, "base", system51), lineupFor(2));
});

test("4-2: nur 3 Rotationen, Zuspieler ist immer der hintere", () => {
  const pattern = ["setter", "outside", "middle", "setter", "outside", "middle"];
  assert.equal(rotationCount(pattern), 3);
  assert.equal(rotationCount(PATTERN_5_1), 6);
  const start = ["Z1", "A1", "M1", "Z2", "A2", "M2"];
  // Z1 auf 1 -> Rotation 1 mit Z1; Z1 auf 4 (Z2 auf 1) -> wieder Rotation 1, jetzt mit Z2
  assert.deepEqual(findRotation(lineupFor(1, start), roleOf, pattern), { r: 1, s: 0 });
  assert.deepEqual(findRotation(lineupFor(4, start), roleOf, pattern), { r: 1, s: 0 });
  assert.deepEqual(findRotation(lineupFor(5, start), roleOf, pattern), { r: 2, s: 5 });
  const system = buildSystem("x", "4-2", pattern);
  assert.deepEqual(Object.keys(system.play), ["1", "2", "3"]);
  assert.deepEqual(system.receive[1], system.play[1]); // Annahme startet als Kopie
});

test("Kurznamen pro Rotation (Libero = hintere Mitte)", () => {
  const abbr = (role) => ({ setter: "Z", outside: "A", middle: "M", opposite: "D", libero: "L" })[role];
  assert.deepEqual(systemLabels(PATTERN_5_1, 1, abbr), ["Z", "A1", "M1", "D", "A2", "L"]);
  assert.deepEqual(systemLabels(PATTERN_5_1, 3, abbr), ["Z", "A1", "L", "D", "A2", "M2"]);
});

test("System fürs Spiel: gewählt, sonst Standard des Teams, sonst eingebautes 5-1", () => {
  const a = buildSystem("a", "A", PATTERN_5_1);
  const b = buildSystem("b", "B", PATTERN_5_1);
  const team = { systems: [a, b], defaultSystemId: "b" };
  assert.equal(pickSystem(team, "a").id, "a");
  assert.equal(pickSystem(team, "gelöscht").id, "b");
  assert.equal(pickSystem(null, null).id, "5-1");
});

test("Tausch im Spiel: Felder tauschen, unbekannte Personen überspringen", () => {
  const fields = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(applySwaps(fields, [["a", "c"]]), ["c", "b", "a", "d", "e", "f"]);
  assert.deepEqual(applySwaps(fields, [["a", "c"], ["a", "f"]]), ["c", "b", "f", "d", "e", "a"]);
  assert.deepEqual(applySwaps(fields, [["a", "x"]]), fields);
});
