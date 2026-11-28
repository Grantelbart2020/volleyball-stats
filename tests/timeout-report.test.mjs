/*
  timeout-report.test.mjs – automatische Tests für js/timeout-report.js (Auszeit-Check).

  Ausführen im Projektordner:
    node --test tests/timeout-report.test.mjs
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWN, OPP } from "../js/rules.js";
import { buildBriefing, exceeds, MAX_ITEMS } from "../js/timeout-report.js";

const touch = (team, playerId, action, quality, extra = {}) =>
  ({ team, playerId, action, quality, zone: null, courtPos: null, ...extra });
const rally = (serving, winner, touches, extra = {}) =>
  ({ setNumber: 1, serving, server: null, ownLineup: null, touches, winner, reason: "touch", causeId: null, ...extra });

// Wir schlagen auf, Gegner nimmt "+" an (nicht perfekt), greift von Feld pos an
const oppAttackAfterPlus = (pos, winner = OPP) => rally(OWN, winner, [
  touch(OWN, "o1", "serve", "+"),
  touch(OPP, "g5", "reception", "+"),
  touch(OPP, "g1", "set", "+"),
  touch(OPP, "g4", "attack", "+", { courtPos: pos }),
]);

test("Beispiel des Nutzers: 9 von 10 nicht perfekt angenommenen Bällen über Position 4", () => {
  const rallies = [...Array(9).fill(4), 3].map((pos, i) => oppAttackAfterPlus(pos, i % 2 ? OWN : OPP));
  const item = buildBriefing(rallies).items.find((i) => i.key === "oppAttackPosPoor");
  assert.deepEqual({ subject: item.subject, count: item.count, n: item.n }, { subject: "4", count: 9, n: 10 });
});

test("Zu wenige Fälle: 4 von 4 ist noch nicht auffällig (mindestens 5)", () => {
  const rallies = [4, 4, 4, 4].map((pos) => oppAttackAfterPlus(pos));
  assert.equal(buildBriefing(rallies).items.some((i) => i.key === "oppAttackPosPoor"), false);
  assert.equal(exceeds("oppAttackPosPoor", 1, 4), false);
  assert.equal(exceeds("oppAttackPosPoor", 0.6, 5), true);
  assert.equal(exceeds("ownWeakReceiver", 0.4, 4), false); // "unter 40 %" – genau 40 % ist ok
});

test("Kennwerte immer: Side-out-Quote, Fehlaufschläge, mittlere Aufschlagwirkung", () => {
  const rallies = [
    rally(OWN, OWN, [touch(OWN, "o1", "serve", "#")]),           // Ass: Wirkung 100 %
    rally(OWN, OPP, [touch(OWN, "o1", "serve", "=")]),           // Fehler: 0 %
    rally(OPP, OWN, [touch(OPP, "g1", "serve", "+"), touch(OWN, "o5", "reception", "#")]),
    rally(OPP, OPP, [touch(OPP, "g1", "serve", "#")]),
  ];
  const { values } = buildBriefing(rallies);
  assert.deepEqual(values.own.serve, { n: 2, errors: 1, errorShare: 0.5, effect: 0.5 });
  assert.deepEqual(values.own.sideOut, { n: 2, won: 1, share: 0.5 });
  assert.deepEqual(values.opp.sideOut, { n: 2, won: 1, share: 0.5 });
  assert.equal(values.opp.serve.effect, (0.6 + 1) / 2); // "+" = Rang 2 -> 60 %, Ass 100 %
});

test("Gegner-Serie, Rotation, eigene Fehler", () => {
  const lineup = ["o1", "o2", "o3", "o4", "o5", "o6"];
  const lost = () => rally(OWN, OPP, [touch(OWN, "o1", "serve", "=")], { ownLineup: lineup });
  const rallies = [lost(), lost(), lost(), lost()];
  const items = buildBriefing(rallies).items;
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(byKey.oppRun.count, 4);
  assert.deepEqual({ subject: byKey.ownRotation.subject, count: byKey.ownRotation.count }, { subject: "o1", count: 4 });
  assert.equal(byKey.ownFaultShare, undefined); // erst ab 8 Gegnerpunkten
});

test("Höchstens 5 Merkmale, das stärkste zuerst", () => {
  const rallies = Array.from({ length: 10 }, () => rally(OPP, OPP, [
    touch(OPP, "g2", "serve", "#"),
    touch(OWN, "o5", "reception", "="),
  ], { server: "g2", ownLineup: ["o1"] }));
  const { items } = buildBriefing(rallies);
  assert.ok(items.length <= MAX_ITEMS);
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].score >= items[i].score);
});
