/*
  rules.test.mjs – automatische Tests für js/rules.js.

  Ausführen im Projektordner (Terminal in VS Code):
    node --test tests/rules.test.mjs
  "node:test" und "node:assert" sind in Node.js eingebaut, es wird nichts installiert.
  Jeder test(...) prüft eine Regel. assert.equal(a, b) heißt: a muss gleich b sein
  (wie "assert a == b" in Python).
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OWN, OPP, defaultRules, seasonForDate, checkOwnRoster, isDecidingSet, pointsToWin,
  setWinner, suggestedFirstServe, rotate, lineupError, computeMatch, setStartError,
  validLiberoSwaps, suggestLiberoSwap, liberoSwapError, rallyError, substitutionError, eventError,
  touchOutcome, suggestPoint, suggestAction, touchError,
} from "../js/rules.js";

const rules = defaultRules();

/* ---------- Testdaten ---------- */

// Eigene Spieler o1..o8 und Libero oL, Gegner g1..g6
const ownIds = ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"];
const oppIds = ["g1", "g2", "g3", "g4", "g5", "g6"];
const players = [
  ...ownIds.map((id) => ({ id, side: OWN, isLibero: false })),
  { id: "oL", side: OWN, isLibero: true },
  ...oppIds.map((id) => ({ id, side: OPP, isLibero: false })),
];

// Satzstart: o1 auf Position 1 ... o6 auf Position 6; Libero-Partner o3 und o6
function setStart(setNumber, firstServe, extra = {}) {
  return {
    type: "setStart", setNumber, firstServe,
    lineup: { own: ["o1", "o2", "o3", "o4", "o5", "o6"], opp: null },
    liberoPartners: { own: ["o3", "o6"], opp: [] },
    ...extra,
  };
}
const point = (winner) => ({ type: "point", winner });
const points = (winner, n) => Array.from({ length: n }, () => point(winner));
const state = (events) => computeMatch(rules, players, events);

/* ---------- Saison und Kader ---------- */

test("Saison beginnt im Juli", () => {
  assert.equal(seasonForDate(new Date(2026, 6, 1)), "2026/27");  // 1. Juli 2026
  assert.equal(seasonForDate(new Date(2027, 5, 30)), "2026/27"); // 30. Juni 2027
  assert.equal(seasonForDate(new Date(2099, 11, 31)), "2099/00");
});

test("Spielkader: harte Grenzen und Warnung", () => {
  const make = (n, liberos) => Array.from({ length: n }, (_, i) => ({ isLibero: i < liberos }));
  assert.deepEqual(checkOwnRoster(make(14, 2), rules), { errors: [], warnings: [] });
  assert.deepEqual(checkOwnRoster(make(15, 2), rules).errors, ["rosterTooMany"]);
  assert.deepEqual(checkOwnRoster(make(10, 3), rules).errors, ["tooManyLiberos"]);
  assert.deepEqual(checkOwnRoster(make(13, 1), rules).warnings, ["needTwoLiberos"]);
  assert.deepEqual(checkOwnRoster(make(12, 1), rules).warnings, []);
});

/* ---------- Satzregeln ---------- */

test("Entscheidungssatz und Zielpunkte", () => {
  assert.equal(isDecidingSet(5, rules), true);
  assert.equal(isDecidingSet(4, rules), false);
  assert.equal(pointsToWin(1, rules), 25);
  assert.equal(pointsToWin(5, rules), 15);
  const bestOf3 = { ...rules, setsToWin: 2 };
  assert.equal(pointsToWin(3, bestOf3), 15);
});

test("Satzende mit 2 Punkten Abstand, ohne Obergrenze", () => {
  assert.equal(setWinner({ own: 25, opp: 23 }, 25, 2), OWN);
  assert.equal(setWinner({ own: 25, opp: 24 }, 25, 2), null);
  assert.equal(setWinner({ own: 31, opp: 33 }, 25, 2), OPP);
  assert.equal(setWinner({ own: 24, opp: 10 }, 25, 2), null);
});

test("Erster Aufschlag: Satz 1 und 5 fragen, sonst abwechseln", () => {
  const sets = [{ firstServe: OWN }, { firstServe: OPP }, { firstServe: OWN }, { firstServe: OPP }];
  assert.equal(suggestedFirstServe(1, [], rules), null);
  assert.equal(suggestedFirstServe(2, sets, rules), OPP);
  assert.equal(suggestedFirstServe(3, sets, rules), OWN);
  assert.equal(suggestedFirstServe(5, sets, rules), null);
});

/* ---------- Rotation ---------- */

test("Rotation: Position 2 rückt auf Position 1", () => {
  assert.deepEqual(rotate(["p1", "p2", "p3", "p4", "p5", "p6"]), ["p2", "p3", "p4", "p5", "p6", "p1"]);
});

test("Aufstellung prüfen", () => {
  assert.equal(lineupError(["o1", "o2", "o3", "o4", "o5", "o6"], ownIds), null);
  assert.equal(lineupError(["o1", "o2", "o3", "o4", "o5", ""], ownIds), "lineupIncomplete");
  assert.equal(lineupError(["o1", "o1", "o3", "o4", "o5", "o6"], ownIds), "lineupDuplicate");
  assert.equal(lineupError(["o1", "o2", "o3", "o4", "o5", "oL"], ownIds), "lineupInvalid");
});

test("Nur wer den Aufschlag zurückholt, rotiert", () => {
  // Wir schlagen auf und machen den Punkt: keine Rotation
  let s = state([setStart(1, OWN), point(OWN)]).activeSet;
  assert.deepEqual(s.teams.own.lineup, ["o1", "o2", "o3", "o4", "o5", "o6"]);
  assert.equal(s.serving, OWN);
  // Gegner holt den Aufschlag, dann wir zurück: jetzt rotieren wir
  s = state([setStart(1, OWN), point(OPP), point(OWN)]).activeSet;
  assert.deepEqual(s.teams.own.lineup, ["o2", "o3", "o4", "o5", "o6", "o1"]);
  assert.equal(s.serving, OWN);
  assert.deepEqual(s.score, { own: 1, opp: 1 });
});

test("Gegner annehmen beim Start: erster gewonnener Ballwechsel rotiert", () => {
  const s = state([setStart(1, OPP), point(OWN)]).activeSet;
  assert.equal(s.teams.own.lineup[0], "o2");
});

/* ---------- Spielverlauf ---------- */

test("Satz und Spiel enden bei 3 Gewinnsätzen", () => {
  const events = [];
  for (let n = 1; n <= 3; n++) events.push(setStart(n, OWN), ...points(OWN, 25));
  const m = state(events);
  assert.deepEqual(m.setsWon, { own: 3, opp: 0 });
  assert.equal(m.matchOver, true);
  assert.equal(m.activeSet, null);
  assert.equal(m.nextSetNumber, null);
});

test("Nach Satzende wird der nächste Satz erwartet", () => {
  const m = state([setStart(1, OWN), ...points(OPP, 25)]);
  assert.equal(m.sets[0].winner, OPP);
  assert.equal(m.nextSetNumber, 2);
  assert.equal(rallyError(m.sets[0]), "setOver");
});

test("Satzstart prüfen", () => {
  const empty = state([]);
  assert.equal(setStartError(empty, setStart(1, OWN), players), null);
  assert.equal(setStartError(empty, setStart(1, null), players), "firstServeMissing");
  assert.equal(setStartError(empty, setStart(2, OWN), players), "wrongSet");
  const fewOpp = players.filter((p) => p.id !== "g6");
  assert.equal(setStartError(empty, setStart(1, OWN), fewOpp), "opponentRosterTooSmall");
  const badPartner = setStart(1, OWN, { liberoPartners: { own: ["o7"], opp: [] } });
  assert.equal(setStartError(empty, badPartner, players), "partnerInvalid");
  const running = state([setStart(1, OWN)]);
  assert.equal(setStartError(running, setStart(2, OWN), players), "setRunning");
});

/* ---------- Libero ---------- */

test("Libero nur für Hinterspieler und nie für den Aufschläger", () => {
  // Wir schlagen auf: o1 (Pos. 1) schlägt auf, Libero darf für o5 und o6 kommen
  const s = state([setStart(1, OWN)]).activeSet;
  const outs = validLiberoSwaps(s, OWN).map((o) => o.outId);
  assert.deepEqual(outs.sort(), ["o5", "o6"]);
  // Gegner schlägt auf: auch o1 auf Position 1 ist möglich
  const s2 = state([setStart(1, OPP)]).activeSet;
  assert.deepEqual(validLiberoSwaps(s2, OWN).map((o) => o.outId).sort(), ["o1", "o5", "o6"]);
});

test("Vorschlag: Libero für einen Partner, der hinten steht", () => {
  const s = state([setStart(1, OWN)]).activeSet;
  assert.deepEqual(suggestLiberoSwap(s, OWN), { team: OWN, outId: "o6", inId: "oL", mandatory: false });
});

test("Zwischen zwei Libero-Täuschen muss ein Ballwechsel liegen", () => {
  const swap = { type: "liberoSwap", team: OWN, outId: "o6", inId: "oL" };
  const s = state([setStart(1, OWN), swap]).activeSet;
  assert.equal(liberoSwapError(s, OWN, "oL", "o6"), "liberoSwapInvalid");
  const after = state([setStart(1, OWN), swap, point(OWN)]).activeSet;
  assert.equal(liberoSwapError(after, OWN, "oL", "o6"), null);
  assert.equal(liberoSwapError(after, OWN, "oL", "o2"), "liberoSwapInvalid"); // nur der Ersetzte
});

test("Libero muss raus, wenn er nach vorne rotiert, und blockiert bis dahin", () => {
  // Libero kommt für o5 (Position 5). Nach einer Rotation steht er auf Position 4.
  const events = [setStart(1, OPP), { type: "liberoSwap", team: OWN, outId: "o5", inId: "oL" }];
  const before = state(events).activeSet;
  assert.equal(before.teams.own.lineup[4], "oL");
  const s = state([...events, point(OWN)]).activeSet;
  assert.equal(s.teams.own.lineup[3], "oL"); // Position 4 = vorne
  assert.deepEqual(suggestLiberoSwap(s, OWN), { team: OWN, outId: "oL", inId: "o5", mandatory: true });
  assert.equal(rallyError(s), "liberoMustExit");
  const fixed = state([...events, point(OWN), { type: "liberoSwap", team: OWN, outId: "oL", inId: "o5" }]).activeSet;
  assert.equal(fixed.teams.own.libero, null);
  assert.equal(rallyError(fixed), null);
});

/* ---------- Auswechslungen ---------- */

const ownTeamIds = [...ownIds, "oL"];
const sub = (outId, inId, exceptional = false) => ({ type: "substitution", team: OWN, outId, inId, exceptional });
const subError = (events, outId, inId, exceptional = false) =>
  substitutionError(state([setStart(1, OWN), ...events]).activeSet, OWN, { outId, inId, exceptional }, rules, ownTeamIds);

test("Normale Auswechslung und Rückwechsel nur auf den eigenen Platz", () => {
  assert.equal(subError([], "o2", "o7"), null);
  // o7 kam für o2: o7 darf nur gegen o2 wieder raus
  assert.equal(subError([sub("o2", "o7")], "o7", "o8"), "mustReturnStarter");
  assert.equal(subError([sub("o2", "o7")], "o7", "o2"), null);
  // o2 war schon raus und zurück: darf nicht noch einmal raus
  assert.equal(subError([sub("o2", "o7"), sub("o7", "o2")], "o2", "o8"), "starterAlreadyOut");
  // o7 hat schon gespielt: darf nicht für einen anderen Startspieler kommen
  assert.equal(subError([sub("o2", "o7"), sub("o7", "o2")], "o3", "o7"), "subAlreadyUsed");
});

test("Auswechslung: Grundprüfungen", () => {
  assert.equal(subError([], "o7", "o8"), "notOnCourt");
  assert.equal(subError([], "o2", "o3"), "alreadyOnCourt");
  assert.equal(subError([], "o2", "oL"), "liberoNoSub");
  assert.equal(subError([], "o2", "x9"), "notInRoster");
});

test("Höchstens 6 Auswechslungen, Ausnahmewechsel geht trotzdem", () => {
  const limited = { ...rules, maxSubstitutions: 1 };
  const s = state([setStart(1, OWN), sub("o2", "o7")]).activeSet;
  assert.equal(substitutionError(s, OWN, { outId: "o3", inId: "o8" }, limited, ownTeamIds), "subLimit");
  assert.equal(substitutionError(s, OWN, { outId: "o3", inId: "o8", exceptional: true }, limited, ownTeamIds), null);
});

test("Doppeltes Antippen: Satz kann nicht zweimal starten, Punkt nur im laufenden Satz", () => {
  const running = state([setStart(1, OWN)]);
  assert.equal(eventError(running, setStart(1, OWN), players, rules), "setRunning");
  assert.equal(eventError(running, point(OWN), players, rules), null);
  const finished = state([setStart(1, OWN), ...points(OWN, 25)]);
  assert.equal(eventError(finished, point(OWN), players, rules), "noActiveSet");
  assert.equal(eventError(running, sub("o2", "o7"), players, rules), null);
  assert.equal(eventError(running, sub("o7", "o2"), players, rules), "notOnCourt");
});

test("Eingewechselter übernimmt die Libero-Partnerschaft", () => {
  const s = state([setStart(1, OWN), sub("o6", "o7")]).activeSet;
  assert.deepEqual(s.teams.own.partners, ["o3", "o7"]);
  assert.equal(s.teams.own.subCount, 1);
});

/* ---------- Ballberührungen ---------- */

// Berührung: team, Spieler, Aktion, Bewertungscode
const touch = (team, playerId, action, quality) => ({ type: "touch", team, playerId, action, quality });
const oppTeamIds = oppIds;

test("Berührungen sammeln sich im Ballwechsel, ein Punkt leert ihn", () => {
  const events = [setStart(1, OPP), touch(OPP, null, "serve", "+"), touch(OWN, "o5", "reception", "!")];
  const s = state(events).activeSet;
  assert.equal(s.rally.length, 2);
  assert.deepEqual(s.rally[1], { team: OWN, playerId: "o5", action: "reception", quality: "!" });
  assert.deepEqual(s.score, { own: 0, opp: 0 }); // Berührungen ändern den Spielstand nicht
  const after = state([...events, point(OWN)]).activeSet;
  assert.deepEqual(after.rally, []);
  assert.equal(after.rallies, 1);
});

test("Punktvorschlag: Ass, Angriffs- und Blockpunkt, Fehler", () => {
  assert.equal(touchOutcome({ team: OWN, action: "serve", quality: "#" }), OWN);
  assert.equal(touchOutcome({ team: OWN, action: "attack", quality: "#" }), OWN);
  assert.equal(touchOutcome({ team: OPP, action: "block", quality: "#" }), OPP);
  assert.equal(touchOutcome({ team: OWN, action: "reception", quality: "=" }), OPP);
  assert.equal(touchOutcome({ team: OPP, action: "attack", quality: "=" }), OWN);
  assert.equal(touchOutcome({ team: OWN, action: "reception", quality: "#" }), null); // perfekte Annahme: weiter
  assert.equal(touchOutcome({ team: OWN, action: "attack", quality: "+" }), null);

  const s = state([setStart(1, OWN), touch(OWN, "o1", "serve", "#")]).activeSet;
  assert.equal(suggestPoint(s).winner, OWN);
  assert.equal(suggestPoint(state([setStart(1, OWN)]).activeSet), null);
});

test("Aktionsvorschlag folgt dem Ballwechsel", () => {
  const base = [setStart(1, OPP)];
  const at = (events) => state([...base, ...events]).activeSet;
  // Gegner schlägt auf: wir nehmen an
  assert.equal(suggestAction(at([]), OPP, null), "serve");
  assert.equal(suggestAction(at([]), OWN, "o5"), "reception");
  const afterServe = [touch(OPP, null, "serve", "+")];
  assert.equal(suggestAction(at(afterServe), OWN, "o5"), "reception");
  const afterRec = [...afterServe, touch(OWN, "o5", "reception", "+")];
  assert.equal(suggestAction(at(afterRec), OWN, "o3"), "set");
  const afterSet = [...afterRec, touch(OWN, "o3", "set", "+")];
  assert.equal(suggestAction(at(afterSet), OWN, "o4"), "attack");
  // Gegnerischer Angriff: vorne Block, hinten Abwehr
  const oppAttack = [...afterServe, touch(OWN, "o5", "reception", "-"), touch(OWN, "o4", "freeball", "!"),
    touch(OPP, null, "attack", "+")];
  assert.equal(suggestAction(at(oppAttack), OWN, "o2"), "block"); // o2 steht auf Position 2 (vorne)
  assert.equal(suggestAction(at(oppAttack), OWN, "o6"), "dig");   // o6 steht auf Position 6 (hinten)
  // Ball kommt "frei" herüber (z. B. nach gegnerischem Zuspiel): Freeball
  const oppSet = [...afterServe, touch(OWN, "o5", "reception", "-"), touch(OPP, null, "set", "!")];
  assert.equal(suggestAction(at(oppSet), OWN, "o6"), "freeball");
});

test("Berührung prüfen", () => {
  const s = state([setStart(1, OWN)]).activeSet;
  const check = (t, set = s) => touchError(set, t, t.team === OWN ? ownTeamIds : oppTeamIds);
  assert.equal(check(touch(OWN, "o1", "serve", "+")), null);
  assert.equal(check(touch(OWN, "o2", "serve", "+")), "notServer");   // nur Position 1 schlägt auf
  assert.equal(check(touch(OPP, null, "serve", "+")), "notServing");
  assert.equal(check(touch(OWN, "o7", "dig", "+")), "notOnCourt");    // o7 sitzt auf der Bank
  assert.equal(check(touch(OPP, null, "dig", "+")), null);            // Gegner ohne Aufstellung: Mannschaft
  assert.equal(check(touch(OPP, "g3", "dig", "+")), null);            // ... oder Spieler aus dem Kader
  assert.equal(check(touch(OPP, "x9", "dig", "+")), "notInRoster");
  assert.equal(check(touch(OWN, "o2", "jump", "+")), "unknownAction");
  assert.equal(check(touch(OWN, "o2", "dig", "?")), "unknownQuality");

  const served = state([setStart(1, OWN), touch(OWN, "o1", "serve", "+")]).activeSet;
  assert.equal(check(touch(OWN, "o1", "serve", "+"), served), "serveNotFirst");
  // Nach einem Ass ist der Ballwechsel entschieden: erst den Punkt eintragen
  const ace = state([setStart(1, OWN), touch(OWN, "o1", "serve", "#")]).activeSet;
  assert.equal(check(touch(OPP, null, "reception", "="), ace), "rallyDecided");
  // Über eventError (wie beim Speichern)
  assert.equal(eventError(state([setStart(1, OWN)]), touch(OWN, "o1", "serve", "+"), players, rules), null);
});

test("Wechsel und Libero-Tausch nur zwischen den Ballwechseln", () => {
  const events = [setStart(1, OPP), touch(OPP, null, "serve", "+")];
  const s = state(events).activeSet;
  assert.equal(substitutionError(s, OWN, { outId: "o2", inId: "o7" }, rules, ownTeamIds), "rallyRunning");
  assert.deepEqual(validLiberoSwaps(s, OWN), []);
  assert.equal(suggestLiberoSwap(s, OWN), null);
  const after = state([...events, point(OPP)]).activeSet;
  assert.equal(substitutionError(after, OWN, { outId: "o2", inId: "o7" }, rules, ownTeamIds), null);
});
