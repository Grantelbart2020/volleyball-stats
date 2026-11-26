// Tests für formation.js (Laufwege). Start: node --test tests/formation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { courtFields, formationPhase } from "../js/formation.js";

const ROLE = { Z: "setter", A1: "outside", A2: "outside", M1: "middle", M2: "middle", D: "opposite", L: "libero" };
const roleOf = (id) => ROLE[id];

// Rotation r (1–6): Z auf 1, 6, 5, 4, 3, 2; die hintere Mitte ist durch L ersetzt
function lineupFor(r) {
  let lineup = ["Z", "A1", "M1", "D", "A2", "M2"];
  for (let i = 1; i < r; i++) lineup = [...lineup.slice(1), lineup[0]];
  return lineup.map((id, i) => ([0, 4, 5].includes(i) && id.startsWith("M") ? "L" : id));
}

// Anzeige wie in der Tabelle des Nutzers: vorne 4 3 2 | hinten 5 6 1
const show = (f) => `${[4, 3, 2].map((p) => f[p - 1]).join(" ")} | ${[5, 6, 1].map((p) => f[p - 1]).join(" ")}`;

test("Annahme-Formation laut Tabelle des Nutzers", () => {
  const table = [
    "D M1 Z | A2 L A1",
    "D Z M1 | A2 L A1",
    "M2 Z D | A2 A1 L",
    "Z M2 D | A1 L A2",
    "D Z M2 | A1 L A2",
    "D M1 Z | A1 A2 L",
  ];
  table.forEach((row, i) => assert.equal(show(courtFields(lineupFor(i + 1), roleOf, "receive")), row, `Rotation ${i + 1}`));
});

test("Spielposition: vorne A M Z/D, hinten L/M A Z/D", () => {
  // Rotation 1: vorne A1(2) M1(3) D(4) -> A1 links, M1 Mitte, D rechts
  assert.equal(show(courtFields(lineupFor(1), roleOf, "play")), "A1 M1 D | L A2 Z");
  // Rotation 4 (Z vorne auf 4): vorne Z M2 A2 -> A2 M2 Z; hinten D(1) L(6) A1(5) -> L A1 D
  assert.equal(show(courtFields(lineupFor(4), roleOf, "play")), "A2 M2 Z | L A1 D");
});

test("Passt eine Reihe nicht, bleibt sie offiziell", () => {
  const lineup = lineupFor(1); // vorne A1 M1 D
  const noRole = (id) => (id === "M1" ? null : ROLE[id]);
  // vorne ohne Position -> offiziell (4 3 2 = D M1 A1); hinten wird trotzdem sortiert
  assert.equal(show(courtFields(lineup, noRole, "play")), "D M1 A1 | L A2 Z");
  // Annahme ohne passendes Muster -> ganz offiziell
  assert.deepEqual(courtFields(lineup, noRole, "receive"), lineup);
});

test("Phase: Aufschlag, Annahme, nach der ersten eigenen Berührung", () => {
  assert.equal(formationPhase([], "own", "own"), "base");
  assert.equal(formationPhase([], "own", "opp"), "receive");
  assert.equal(formationPhase([{ team: "opp" }], "own", "opp"), "receive");
  assert.equal(formationPhase([{ team: "opp" }, { team: "own" }], "own", "opp"), "play");
  assert.equal(formationPhase([{ team: "own" }], "own", "own"), "play");
  assert.deepEqual(courtFields(lineupFor(2), roleOf, "base"), lineupFor(2));
});
