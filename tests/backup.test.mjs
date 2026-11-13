/*
  backup.test.mjs – automatische Tests für js/backup.js (Sicherung und Import).
  Ausführen im Projektordner:  node --test tests/backup.test.mjs
  (alle Tests: node --test tests/rules.test.mjs tests/backup.test.mjs)
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBackup, matchSubset, parseBackup, planImport, planIsEmpty, STORES } from "../js/backup.js";

// Leerer Datenbestand mit allen Stores
const empty = () => Object.fromEntries(STORES.map((s) => [s, []]));
const T1 = "2026-11-01T10:00:00.000Z";
const T2 = "2026-11-02T10:00:00.000Z";

function sample() {
  const d = empty();
  d.teams.push({ id: "t1", name: "Wir", updatedAt: T1 }, { id: "t2", name: "Gast", updatedAt: T1 });
  d.persons.push({ id: "p1", name: "Anna", updatedAt: T1 }, { id: "p2", name: "Gastspieler", updatedAt: T1 });
  d.rosterEntries.push(
    { id: "r1", teamId: "t1", season: "2026/27", personId: "p1", number: 7, updatedAt: T1 },
    { id: "r2", teamId: "t2", season: "2026/27", personId: "p2", number: 11, updatedAt: T1 },
  );
  d.matches.push({ id: "m1", teamId: "t1", opponentTeamId: "t2", season: "2026/27", updatedAt: T1 });
  d.matchPlayers.push({ id: "mp1", matchId: "m1", side: "own", personId: "p1", number: 7, updatedAt: T1 });
  d.matchEvents.push({ id: "e1", matchId: "m1", seq: 1, type: "setStart" }, { id: "e2", matchId: "m1", seq: 2, type: "point" });
  return d;
}

test("Sicherung: Format, Version und alle Stores", () => {
  const backup = buildBackup(sample(), "full", T1);
  assert.equal(backup.format, "vbstats-backup");
  assert.equal(backup.version, 1);
  assert.equal(backup.kind, "full");
  assert.deepEqual(Object.keys(backup.data), STORES);
  // Rundweg: Text -> prüfen -> gleicher Inhalt
  const { backup: parsed } = parseBackup(JSON.stringify(backup));
  assert.deepEqual(parsed, backup);
});

test("Datei prüfen: kein JSON, falsches Format, neuere Version", () => {
  assert.equal(parseBackup("hallo").error, "importNotJson");
  assert.equal(parseBackup("{}").error, "importWrongFormat");
  assert.equal(parseBackup(JSON.stringify({ format: "vbstats-backup", version: 99, data: {} })).error, "importNewerVersion");
  const broken = buildBackup(sample());
  broken.data.teams.push({ name: "ohne id" });
  assert.equal(parseBackup(JSON.stringify(broken)).error, "importWrongFormat");
});

test("Einzelnes Spiel: Spiel, Kader, Ereignisse, beide Teams und Personen", () => {
  const all = sample();
  all.matches.push({ id: "m2", teamId: "t1", season: "2026/27", updatedAt: T1 });
  all.matchEvents.push({ id: "x1", matchId: "m2", seq: 1 });
  const sub = matchSubset(all, "m1");
  assert.deepEqual(sub.matches.map((m) => m.id), ["m1"]);
  assert.deepEqual(sub.teams.map((t) => t.id).sort(), ["t1", "t2"]);
  assert.deepEqual(sub.matchEvents.map((e) => e.id), ["e1", "e2"]);
  assert.deepEqual(sub.persons.map((p) => p.id).sort(), ["p1", "p2"]);
  assert.equal(matchSubset(all, "nix"), null);
});

test("Import in leeres Gerät übernimmt alles", () => {
  const plan = planImport(empty(), sample());
  assert.equal(plan.put.teams.length, 2);
  assert.equal(plan.put.matchEvents.length, 2);
  assert.equal(plan.stats.teams.added, 2);
  assert.deepEqual(plan.conflicts, []);
});

test("Gleiche Daten noch einmal: nichts zu tun", () => {
  const plan = planImport(sample(), sample());
  assert.equal(planIsEmpty(plan), true);
  assert.equal(plan.stats.teams.unchanged, 2);
});

test("Neuerer Eintrag gewinnt, älterer wird nicht übernommen", () => {
  const incoming = sample();
  incoming.teams[0] = { ...incoming.teams[0], name: "Wir neu", updatedAt: T2 };
  let plan = planImport(sample(), incoming);
  assert.deepEqual(plan.put.teams.map((t) => t.name), ["Wir neu"]);
  assert.equal(plan.stats.teams.updated, 1);
  // umgekehrt: hier ist der neuere Stand -> bleibt
  plan = planImport(incoming, sample());
  assert.equal(plan.put.teams.length, 0);
});

test("Spiel weiter erfasst: neue Ereignisse werden angehängt", () => {
  const incoming = sample();
  incoming.matchEvents.push({ id: "e3", matchId: "m1", seq: 3, type: "point" });
  const plan = planImport(sample(), incoming);
  assert.deepEqual(plan.put.matchEvents.map((e) => e.id), ["e3"]);
  assert.deepEqual(plan.conflicts, []);
});

test("Spiel auf zwei Geräten verschieden erfasst: Konflikt, hier bleibt alles", () => {
  const local = sample();
  local.matchEvents.push({ id: "eL", matchId: "m1", seq: 3 });
  const incoming = sample();
  incoming.matchEvents.push({ id: "eI", matchId: "m1", seq: 3 });
  const plan = planImport(local, incoming);
  assert.equal(plan.put.matchEvents.length, 0);
  assert.deepEqual(plan.conflicts, [{ type: "matchEvents", matchId: "m1" }]);
  assert.equal(plan.stats.matchEvents.skipped, 1);
});

test("Doppelte Trikotnummer wird nicht übernommen", () => {
  const incoming = sample();
  incoming.rosterEntries.push({ id: "r9", teamId: "t1", season: "2026/27", personId: "p9", number: 7, updatedAt: T2 });
  const plan = planImport(sample(), incoming);
  assert.equal(plan.put.rosterEntries.length, 0);
  assert.equal(plan.stats.rosterEntries.skipped, 1);
  assert.equal(plan.conflicts[0].type, "number");
});
