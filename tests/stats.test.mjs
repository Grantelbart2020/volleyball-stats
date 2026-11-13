/*
  stats.test.mjs – automatische Tests für js/stats.js (Auswertung).

  Ausführen im Projektordner:
    node --test tests/stats.test.mjs
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWN, OPP, defaultRules } from "../js/rules.js";
import {
  rankOf, isPoint, isFault, bucketOf, collectRallies, filterSet, setNumbers, playerTable,
  actionSummary, phaseStats, receptionChain, setChain, attackChain, serveChain,
} from "../js/stats.js";

const rules = defaultRules();
const ownIds = ["o1", "o2", "o3", "o4", "o5", "o6"];
const oppIds = ["g1", "g2", "g3", "g4", "g5", "g6"];
const players = [
  ...ownIds.map((id) => ({ id, side: OWN, isLibero: false })),
  ...oppIds.map((id) => ({ id, side: OPP, isLibero: false })),
];

const setStart = (n, firstServe) => ({
  type: "setStart", setNumber: n, firstServe,
  lineup: { own: [...ownIds], opp: null }, liberoPartners: { own: [], opp: [] },
});
const touch = (team, playerId, action, quality) => ({ type: "touch", team, playerId, action, quality });
const point = (winner, reason = "touch", causeId) => ({ type: "point", winner, reason, causeId });

/*
  Kleines Testspiel (Satz 1, Gegner schlägt zuerst auf):
  1) Gegner-Aufschlag, o5 Annahme "!", o2 Zuspiel "+", o4 Angriff "#"  -> Punkt wir (Side-out)
  2) o2 schlägt auf (nach Rotation steht o2 auf Pos. 1) "+", Gegner-Annahme "-",
     ... Gegner punktet                                                   -> Punkt Gegner
  3) Gegner-Aufschlag, o5 Annahme "#", o2 Zuspiel "#", o4 Angriff "="  -> Punkt Gegner
  4) Netz von o3                                                        -> Punkt Gegner
  dazu ein laufender Ballwechsel ohne Punkt (zählt nicht).
*/
const events = [
  setStart(1, OPP),
  touch(OPP, null, "serve", "!"),
  touch(OWN, "o5", "reception", "!"),
  touch(OWN, "o2", "set", "+"),
  touch(OWN, "o4", "attack", "#"),
  point(OWN),
  touch(OWN, "o2", "serve", "+"),
  touch(OPP, null, "reception", "-"),
  point(OPP, "other"),
  touch(OPP, null, "serve", "+"),
  touch(OWN, "o5", "reception", "#"),
  touch(OWN, "o2", "set", "#"),
  touch(OWN, "o4", "attack", "="),
  point(OPP),
  point(OPP, "net", "o3"),
  touch(OPP, null, "serve", "!"),
];

const rallies = collectRallies(rules, players, events);

test("Bewertungen: Rang, Punkt, Fehler", () => {
  assert.equal(rankOf("serve", "/"), 1); // Aufschlag "/" ist zweitbestes Ergebnis
  assert.equal(rankOf("attack", "/"), 4);
  assert.equal(isPoint("attack", "#"), true);
  assert.equal(isPoint("set", "#"), false);
  assert.equal(isFault("attack", "/"), true); // geblockt
  assert.equal(isFault("reception", "="), true);
  assert.equal(isFault("serve", "/"), false);
  assert.deepEqual([0, 1, 2, 3, 5].map(bucketOf), ["good", "good", "medium", "poor", "poor"]);
});

test("Ballwechsel: nur abgeschlossene, mit Aufschlagteam", () => {
  assert.equal(rallies.length, 4);
  assert.deepEqual(rallies.map((r) => r.serving), [OPP, OWN, OPP, OPP]);
  assert.deepEqual(rallies.map((r) => r.winner), [OWN, OPP, OPP, OPP]);
  assert.equal(rallies[3].causeId, "o3");
  assert.equal(rallies[0].touches.length, 4);
  assert.deepEqual(setNumbers(rallies), [1]);
  assert.equal(filterSet(rallies, 2).length, 0);
  assert.equal(filterSet(rallies, null).length, 4);
});

test("Gesamttabelle: Zählung, Punkte, Fehler, Verursacher", () => {
  const { players: rows, totals } = playerTable(rallies);
  assert.equal(rows.get("o4").actions.attack.total, 2);
  assert.equal(rows.get("o4").actions.attack.byCode["#"], 1);
  assert.equal(rows.get("o4").points, 1);
  assert.equal(rows.get("o4").faults, 1);
  assert.equal(rows.get("o3").faults, 1); // Netz
  assert.equal(totals.faults, 2);
  assert.equal(totals.actions.reception.total, 2);
  // Gegner-Tabelle: Mannschaft ohne Spieler zählt nur in totals
  const opp = playerTable(rallies, OPP);
  assert.equal(opp.players.size, 0);
  assert.equal(opp.totals.actions.serve.total, 2); // der laufende Ballwechsel zählt nicht
});

test("Kennzahlen: Effektivität und Effizienz (alte, genormte Formeln)", () => {
  const counts = { total: 10, byCode: { "#": 4, "+": 2, "!": 1, "-": 0, "/": 1, "=": 2 } };
  const attack = actionSummary("attack", counts);
  assert.equal(attack.effectiveness, 0.6);        // (# + +) / alle
  assert.equal(attack.efficiency, (4 - 2) / 10);  // (# − =) / alle, "geblockt" zählt nicht
  const serve = actionSummary("serve", counts);
  assert.equal(serve.effectiveness, 0.6);         // auch beim Aufschlag nur # und +
  assert.equal(serve.efficiency, (4 - 2) / 10);
  // Nachgerechnet mit der alten Auswertung (Annahme: 38 # , 60 +, 6 =, 144 gesamt -> 68 % / 22 %)
  const old = actionSummary("reception", { total: 144, byCode: { "#": 38, "+": 60, "!": 19, "-": 10, "/": 11, "=": 6 } });
  assert.equal(Math.round(old.effectiveness * 100), 68);
  assert.equal(Math.round(old.efficiency * 100), 22);
  assert.equal(actionSummary("set", { total: 0, byCode: counts.byCode }).efficiency, null);
});

test("Side-out und Break", () => {
  const phase = phaseStats(rallies);
  assert.deepEqual(phase.sideOut, { n: 3, won: 1 });
  assert.deepEqual(phase.break, { n: 1, won: 0 });
  assert.equal(phase.points, 1);
  assert.equal(phase.pointsLost, 3);
});

test("Verkettung: Annahme → Ballwechsel", () => {
  const chain = receptionChain(rallies);
  assert.deepEqual(chain.byCode["!"], { n: 1, attacks: 1, kills: 1, won: 1 });
  assert.deepEqual(chain.byCode["#"], { n: 1, attacks: 1, kills: 0, won: 0 });
  assert.deepEqual(chain.total, { n: 2, attacks: 2, kills: 1, won: 1 });
});

test("Verkettung: Zuspiel nach Vorlage", () => {
  const chain = setChain(rallies);
  assert.equal(chain.matrix[2][1], 1); // Annahme ~ -> Zuspiel +
  assert.equal(chain.matrix[0][0], 1); // Annahme ★ -> Zuspiel ★
  assert.deepEqual(chain.setters.get("o2").medium, { n: 1, good: 1 });
  assert.deepEqual(chain.totals.good, { n: 1, good: 1 });
  assert.equal(chain.noInput, 0);
});

test("Verkettung: Angriff nach Vorlage", () => {
  const chain = attackChain(rallies);
  assert.deepEqual(chain.attackers.get("o4").good, { n: 2, kills: 1, errors: 1 });
  // Angriff ohne Vorlage (erste erfasste Berührung)
  const lonely = collectRallies(rules, players, [
    setStart(1, OPP), touch(OPP, null, "serve", "!"), touch(OWN, "o4", "attack", "#"), point(OWN),
  ]);
  assert.deepEqual(attackChain(lonely).totals.none, { n: 1, kills: 1, errors: 0 });
});

test("Verkettung: Aufschlag → gegnerische Annahme → Break", () => {
  const chain = serveChain(rallies);
  assert.deepEqual(chain.outcomes["-"], { n: 1, won: 0 });
  assert.deepEqual(chain.servers.get("o2"), { n: 1, aces: 0, errors: 0, poorReception: 1, won: 0 });
  // Ass mit Spiegel-Annahme zählt als Ass, Fehler als Fehler, ohne Annahme "nicht erfasst"
  const more = collectRallies(rules, players, [
    setStart(1, OWN),
    touch(OWN, "o1", "serve", "#"), touch(OPP, null, "reception", "="), point(OWN),
    touch(OWN, "o1", "serve", "="), point(OPP),
    touch(OPP, null, "serve", "-"), touch(OWN, "o5", "reception", "#"), touch(OWN, "o4", "attack", "#"), point(OWN),
    touch(OWN, "o2", "serve", "!"), point(OWN, "other"),
  ]);
  const c = serveChain(more);
  assert.deepEqual(c.outcomes.ace, { n: 1, won: 1 });
  assert.deepEqual(c.outcomes.error, { n: 1, won: 0 });
  assert.deepEqual(c.outcomes.unrecorded, { n: 1, won: 1 });
  assert.equal(c.servers.get("o1").aces, 1);
  assert.equal(c.servers.get("o1").errors, 1);
});
