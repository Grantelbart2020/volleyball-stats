/*
  stats.js – Auswertung eines Spiels als reine Funktionen.

  Wie rules.js kennt diese Datei weder Bildschirm noch Datenbank: Sie bekommt
  die gespeicherten Ereignisse und gibt Zahlen zurück. Deshalb lässt sie sich
  automatisch testen (tests/stats.test.mjs).

  Grundbaustein ist der BALLWECHSEL (rally): alle Berührungen zwischen zwei
  Punkten, dazu wer aufgeschlagen hat und wer den Punkt bekam. Daraus entstehen
  - die Gesamttabelle (Spieler × Aktion × Bewertungsstufe),
  - Side-out und Break,
  - die VERKETTUNG: Wie hängt eine Berührung von der davor ab?
    (Annahme → Ballwechsel, Vorlage → Zuspiel, Vorlage → Angriff,
     Aufschlag → gegnerische Annahme → Break)

  "Rang" einer Bewertung = wie gut sie ist (0 = am besten, 5 = am schlechtesten),
  pro Aktion aus ratings.js (beim Aufschlag ist "/" das zweitbeste Ergebnis).
*/
import { OWN, OPP, otherTeam, startSet, applyEvent, touchOutcome } from "./rules.js";
import { ACTIONS, codesFor } from "./ratings.js";

/* ---------- Bewertungen ---------- */

// Rang einer Bewertung für eine Aktion (0 = am besten), -1 = unbekannt
export function rankOf(action, code) {
  return codesFor(action).indexOf(code);
}

// Bringt diese Bewertung direkt einen Punkt (Ass, Angriffspunkt, Blockpunkt)?
export function isPoint(action, code) {
  return touchOutcome({ team: OWN, action, quality: code }) === OWN;
}

// Verliert diese Bewertung direkt den Punkt (Fehler, geblockt, Übertritt beim Block)?
export function isFault(action, code) {
  return touchOutcome({ team: OWN, action, quality: code }) === OPP;
}

/*
  Vorlagen-Gruppen für die Verkettung: Wie gut war der Ball, den man bekommen hat?
    good   = Rang 0–1 (★ +)
    medium = Rang 2   (~)
    poor   = Rang 3–5 (− ✖ ⚠)
*/
export const BUCKETS = ["good", "medium", "poor"];

export function bucketOf(rank) {
  if (rank < 0) return null;
  if (rank <= 1) return "good";
  if (rank === 2) return "medium";
  return "poor";
}

// Anteil a/n oder null, wenn n = 0 (dann zeigt der Bericht "–")
export function ratio(a, n) {
  return n ? a / n : null;
}

/* ---------- Ballwechsel aus den Ereignissen ---------- */

/*
  Spielt die Ereignisse wie computeMatch() nach und sammelt jeden
  abgeschlossenen Ballwechsel:
    { setNumber, serving, touches: [{ team, playerId, action, quality, zone }],
      winner, reason, causeId }
  Ein noch laufender Ballwechsel (ohne Punkt) zählt nicht mit.
*/
export function collectRallies(rules, players, events) {
  const liberoIds = {
    own: players.filter((p) => p.side === OWN && p.isLibero).map((p) => p.id),
    opp: players.filter((p) => p.side === OPP && p.isLibero).map((p) => p.id),
  };
  const rallies = [];
  let set = null;
  for (const event of events) {
    if (event.type === "setStart") {
      set = startSet(event, rules, liberoIds);
      continue;
    }
    if (!set) continue;
    if (event.type === "point") {
      rallies.push({
        setNumber: set.number,
        serving: set.serving,
        touches: set.rally,
        winner: event.winner,
        reason: event.reason ?? null,
        causeId: event.causeId ?? null,
      });
    }
    set = applyEvent(set, event);
  }
  return rallies;
}

// Ballwechsel eines Satzes (setNumber null = ganzes Spiel)
export function filterSet(rallies, setNumber) {
  return setNumber ? rallies.filter((r) => r.setNumber === setNumber) : rallies;
}

// Satznummern, die in den Ballwechseln vorkommen
export function setNumbers(rallies) {
  return [...new Set(rallies.map((r) => r.setNumber))].sort((a, b) => a - b);
}

/* ---------- A. Gesamttabelle ---------- */

function emptyCounts() {
  return { total: 0, byCode: { "#": 0, "+": 0, "!": 0, "-": 0, "/": 0, "=": 0 } };
}

function emptyActionCounts() {
  return Object.fromEntries(ACTIONS.map((a) => [a, emptyCounts()]));
}

/*
  Zählt die Berührungen eines Teams:
  {
    players: Map playerId -> { actions: { serve: {total, byCode}, ... }, points, faults },
    totals:  { actions: {...}, points, faults }
  }
  points = direkte Punkte (Ass, Angriffspunkt, Blockpunkt)
  faults = direkte Fehler (jede "="-Berührung, geblockter Angriff, Block "/")
           plus Punkte mit Verursacher (Netz, Übertritt, Karte)
  Berührungen ohne Spieler (playerId null, "die Mannschaft") zählen nur in totals.
*/
export function playerTable(rallies, team = OWN) {
  const players = new Map();
  const totals = { actions: emptyActionCounts(), points: 0, faults: 0 };
  const rowFor = (id) => {
    if (!id) return null;
    if (!players.has(id)) players.set(id, { actions: emptyActionCounts(), points: 0, faults: 0 });
    return players.get(id);
  };

  for (const rally of rallies) {
    for (const touch of rally.touches) {
      if (touch.team !== team) continue;
      const row = rowFor(touch.playerId);
      for (const target of [row, totals].filter(Boolean)) {
        const counts = target.actions[touch.action];
        counts.total += 1;
        counts.byCode[touch.quality] += 1;
        if (isPoint(touch.action, touch.quality)) target.points += 1;
        if (isFault(touch.action, touch.quality)) target.faults += 1;
      }
    }
    // Punkt für den Gegner mit Verursacher aus diesem Team (Netz, Übertritt, Karte)
    if (rally.causeId && rally.winner === otherTeam(team)) {
      totals.faults += 1;
      const row = rally.causeId === "coach" ? null : rowFor(rally.causeId);
      if (row) row.faults += 1;
    }
  }
  return { players, totals };
}

/*
  Kennzahlen einer Aktion aus { total, byCode }:
    effectiveness = Anteil der beiden besten Stufen (★ +)
    efficiency    = (beste Stufe − Punktverluste) / alle
  Beispiel Angriff: (Angriffspunkte − Fehler − geblockt) / Angriffe.
  Beim Aufschlag zählen nach Rang ★ und "/" (sehr positiv) als die beiden besten.
*/
export function actionSummary(action, counts) {
  const order = codesFor(action);
  const best = counts.byCode[order[0]];
  const good = best + counts.byCode[order[1]];
  const lost = order.filter((code) => isFault(action, code)).reduce((sum, code) => sum + counts.byCode[code], 0);
  return {
    total: counts.total,
    effectiveness: ratio(good, counts.total),
    efficiency: ratio(best - lost, counts.total),
  };
}

/* ---------- Side-out und Break ---------- */

/*
  Side-out = Ballwechsel, in denen der GEGNER aufschlägt (wir müssen den
  Aufschlag zurückholen). Break = Ballwechsel mit EIGENEM Aufschlag.
  { sideOut: { n, won }, break: { n, won }, points, pointsLost }
*/
export function phaseStats(rallies) {
  const result = { sideOut: { n: 0, won: 0 }, break: { n: 0, won: 0 }, points: 0, pointsLost: 0 };
  for (const rally of rallies) {
    const phase = rally.serving === OPP ? result.sideOut : result.break;
    phase.n += 1;
    if (rally.winner === OWN) {
      phase.won += 1;
      result.points += 1;
    } else {
      result.pointsLost += 1;
    }
  }
  return result;
}

/* ---------- B. Verkettung ---------- */

// Die Berührung direkt davor, wenn sie vom selben Team kam (= die "Vorlage"), sonst null
function previousOwnTouch(touches, index) {
  const before = touches[index - 1];
  return before && before.team === touches[index].team ? before : null;
}

/*
  B1. Annahme → Ballwechsel
  Für jede Stufe der eigenen Annahme:
    n        = Anzahl Annahmen
    attacks  = davon mit eigenem Angriff im selben Angriffsaufbau
    kills    = davon erster Angriff ein Angriffspunkt (★)
    won      = Ballwechsel gewonnen (Side-out)
  Gezählt wird die erste eigene Annahme im Ballwechsel.
  Rückgabe: { byCode: { "#": {...}, ... }, total: {...} }
*/
export function receptionChain(rallies) {
  const empty = () => ({ n: 0, attacks: 0, kills: 0, won: 0 });
  const byCode = Object.fromEntries(codesFor("reception").map((c) => [c, empty()]));
  const total = empty();
  for (const rally of rallies) {
    const index = rally.touches.findIndex((t) => t.team === OWN && t.action === "reception");
    if (index < 0) continue;
    const reception = rally.touches[index];
    // erster eigener Angriff, bevor der Ball zum Gegner geht
    let attack = null;
    for (const touch of rally.touches.slice(index + 1)) {
      if (touch.team !== OWN) break;
      if (touch.action === "attack") { attack = touch; break; }
    }
    for (const target of [byCode[reception.quality], total]) {
      target.n += 1;
      if (attack) target.attacks += 1;
      if (attack?.quality === "#") target.kills += 1;
      if (rally.winner === OWN) target.won += 1;
    }
  }
  return { byCode, total };
}

/*
  B2. Zuspiel nach Vorlage
  matrix[Rang der Vorlage][Rang des Zuspiels] = Anzahl
    Vorlage = die eigene Berührung direkt vor dem Zuspiel (Annahme, Abwehr, Freeball ...)
  noInput = Zuspiele ohne erfasste Vorlage (z. B. erste Berührung nicht erfasst)
  setters = Map playerId -> { good|medium|poor: { n, good } }
    good = Zuspiele mit Rang 0–1 (★ +) aus dieser Vorlagen-Gruppe
  Daran sieht man, wer aus schlechten Bällen noch gute Zuspiele macht.
*/
export function setChain(rallies) {
  const matrix = Array.from({ length: 6 }, () => Array(6).fill(0));
  let noInput = 0;
  const setters = new Map();
  const totals = Object.fromEntries(BUCKETS.map((b) => [b, { n: 0, good: 0 }]));
  for (const rally of rallies) {
    rally.touches.forEach((touch, index) => {
      if (touch.team !== OWN || touch.action !== "set") return;
      const input = previousOwnTouch(rally.touches, index);
      const setRank = rankOf("set", touch.quality);
      if (!input) { noInput += 1; return; }
      const inputRank = rankOf(input.action, input.quality);
      matrix[inputRank][setRank] += 1;
      const bucket = bucketOf(inputRank);
      if (touch.playerId && !setters.has(touch.playerId)) {
        setters.set(touch.playerId, Object.fromEntries(BUCKETS.map((b) => [b, { n: 0, good: 0 }])));
      }
      for (const target of [setters.get(touch.playerId)?.[bucket], totals[bucket]].filter(Boolean)) {
        target.n += 1;
        if (setRank <= 1) target.good += 1;
      }
    });
  }
  return { matrix, noInput, setters, totals };
}

/*
  B3. Angriff nach Vorlage (meist das Zuspiel)
  attackers = Map playerId -> { good|medium|poor|none: { n, kills, faults } }
    none = Angriff ohne erfasste Vorlage
  totals = dasselbe für das ganze Team.
  Ein Angriffspunkt aus schlechter Vorlage ist mehr wert als aus perfekter.
*/
export const INPUT_GROUPS = [...BUCKETS, "none"];

export function attackChain(rallies) {
  const emptyRow = () => Object.fromEntries(INPUT_GROUPS.map((g) => [g, { n: 0, kills: 0, faults: 0 }]));
  const attackers = new Map();
  const totals = emptyRow();
  for (const rally of rallies) {
    rally.touches.forEach((touch, index) => {
      if (touch.team !== OWN || touch.action !== "attack") return;
      const input = previousOwnTouch(rally.touches, index);
      const group = input ? bucketOf(rankOf(input.action, input.quality)) : "none";
      if (touch.playerId && !attackers.has(touch.playerId)) attackers.set(touch.playerId, emptyRow());
      for (const target of [attackers.get(touch.playerId)?.[group], totals[group]].filter(Boolean)) {
        target.n += 1;
        if (isPoint("attack", touch.quality)) target.kills += 1;
        if (isFault("attack", touch.quality)) target.faults += 1;
      }
    });
  }
  return { attackers, totals };
}

/*
  B4. Aufschlag → gegnerische Annahme → Break
  Jeder eigene Aufschlag landet in genau einer Gruppe:
    "ace"        Ass (★)
    "error"      Aufschlagfehler (⚠)
    "#" … "="    Stufe der gegnerischen Annahme (Rang wie bei der Annahme)
    "unrecorded" keine gegnerische Annahme erfasst
  outcomes[Gruppe] = { n, won }   won = Ballwechsel gewonnen (Break)
  servers = Map playerId -> { n, aces, errors, poorReception, won }
    poorReception = gegnerische Annahme Rang 3–5 (− ✖ ⚠), ohne Asse
*/
export const SERVE_GROUPS = ["ace", ...codesFor("reception"), "unrecorded", "error"];

export function serveChain(rallies) {
  const outcomes = Object.fromEntries(SERVE_GROUPS.map((g) => [g, { n: 0, won: 0 }]));
  const servers = new Map();
  for (const rally of rallies) {
    const index = rally.touches.findIndex((t) => t.team === OWN && t.action === "serve");
    if (index < 0) continue;
    const serve = rally.touches[index];
    const next = rally.touches[index + 1];
    let group = "unrecorded";
    if (isPoint("serve", serve.quality)) group = "ace";
    else if (isFault("serve", serve.quality)) group = "error";
    else if (next && next.team === OPP && next.action === "reception") group = next.quality;

    const won = rally.winner === OWN;
    outcomes[group].n += 1;
    if (won) outcomes[group].won += 1;

    if (!serve.playerId) continue;
    if (!servers.has(serve.playerId)) {
      servers.set(serve.playerId, { n: 0, aces: 0, errors: 0, poorReception: 0, won: 0 });
    }
    const row = servers.get(serve.playerId);
    row.n += 1;
    if (group === "ace") row.aces += 1;
    if (group === "error") row.errors += 1;
    if (codesFor("reception").includes(group) && rankOf("reception", group) >= 3) row.poorReception += 1;
    if (won) row.won += 1;
  }
  return { outcomes, servers };
}
