/*
  timeout-report.js – Kurzbericht für die Auszeit ("Auszeit-Check", Trainerhilfe).
  Reine Funktionen wie stats.js (kein DOM, keine Datenbank), getestet in
  tests/timeout-report.test.mjs.

  Eingabe: abgeschlossene Ballwechsel aus collectRallies() (stats.js).
  Ausgabe:
    values = Kennwerte, die IMMER angezeigt werden (Nutzerwunsch 27.11.2026),
             je Team: Side-out-Quote, Fehlaufschläge, mittlere Aufschlagwirkung
    items  = auffällige Merkmale: nur, wenn der Grenzwert überschritten ist und
             genug Fälle da sind; die stärksten zuerst, höchstens MAX_ITEMS
*/
import { OWN, OPP } from "./rules.js";
import { isFault, rankOf, ratio } from "./stats.js";
import { coarseZone, OUT } from "./zones.js";

export const MAX_ITEMS = 5;

/*
  Grenzwerte (Nutzer 27.11.2026: vorerst diese festen Werte; später aus
  früheren Spielen ableiten). above = auffällig ab Wert >= limit,
  below = auffällig bei Wert < limit. min = Mindestanzahl Fälle (sonst wäre
  "2 von 2" schon 100 %). Anteile als 0…1, ownRotation/oppRun als Anzahl.
*/
export const BENCHMARKS = {
  oppAttackPosPoor: { limit: 0.6, min: 5, dir: "above" }, // Angriffsposition nach nicht perfekter 1. Berührung
  oppAttackPosGood: { limit: 0.6, min: 5, dir: "above" }, // … nach perfekter 1. Berührung
  oppAttackPos: { limit: 0.5, min: 6, dir: "above" },     // Angriffsposition insgesamt
  oppMainAttacker: { limit: 0.4, min: 6, dir: "above" },  // eine Person greift am meisten an
  oppAttackZone: { limit: 0.4, min: 5, dir: "above" },    // Zielzone der Angriffe
  oppServeTarget: { limit: 0.5, min: 5, dir: "above" },   // Aufschlag zielt auf eine Person von uns
  oppWeakReceiver: { limit: 0.4, min: 4, dir: "below" },  // schwache Annahme beim Gegner (# und +)
  oppStrongServer: { limit: 0.5, min: 4, dir: "above" },  // Aufschläger: Ass oder schlechte Annahme bei uns
  ownWeakReceiver: { limit: 0.4, min: 4, dir: "below" },  // schwache eigene Annahme (# und +)
  ownWeakAttacker: { limit: 0.1, min: 4, dir: "below" },  // Effizienz (# − =) / alle
  ownBlocked: { limit: 0.2, min: 6, dir: "above" },       // eigene Angriffe geblockt
  ownBreak: { limit: 0.3, min: 6, dir: "below" },         // Break-Quote
  ownFaultShare: { limit: 0.5, min: 8, dir: "above" },    // Gegnerpunkte durch eigene Fehler
  ownRotation: { limit: 3, min: 4, dir: "above" },        // Punkte mehr verloren als gewonnen
  oppRun: { limit: 3, min: 1, dir: "above" },             // Gegnerpunkte in Folge (am Ende)
  // immer angezeigt; der Grenzwert färbt nur die Warnung
  sideOut: { limit: 0.5, min: 1, dir: "below" },
  serveErrors: { limit: 0.25, min: 1, dir: "above" },
};

// Ist der Wert auffällig? (genug Fälle und über bzw. unter dem Grenzwert)
export function exceeds(key, value, n) {
  const b = BENCHMARKS[key];
  if (value === null || n < b.min) return false;
  return b.dir === "above" ? value >= b.limit : value < b.limit;
}

/*
  Wie stark sticht es hervor? Abstand zum Grenzwert, bezogen auf den Platz bis
  zum Extrem (Anteile) bzw. auf den Grenzwert selbst (Anzahlen).
  shortcut: grobe Rangfolge über verschiedene Merkmale hinweg; genauer erst mit
  Grenzwerten aus früheren Spielen.
*/
function score(key, value) {
  const { limit, dir } = BENCHMARKS[key];
  const span = limit > 1 ? limit : dir === "above" ? 1 - limit : limit;
  return Math.abs(value - limit) / (span || 1) + 0.01;
}

// Häufigster Wert: { key, count, n } (n = alle mit Wert), null ohne Werte
function topShare(values) {
  const counts = new Map();
  for (const v of values) if (v !== null && v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  let top = null;
  for (const [key, count] of counts) if (!top || count > top.count) top = { key, count };
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  return top && { ...top, n };
}

// Gruppiert Einträge nach Schlüssel (null-Schlüssel fallen weg)
function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

const touchesOf = (rallies, team, action) =>
  rallies.flatMap((r) => r.touches.filter((t) => t.team === team && t.action === action));

// Angriffe eines Teams mit der ersten Berührung des Angriffsaufbaus (Annahme/Abwehr/Freeball)
function attacksWithFirst(rallies, team) {
  const list = [];
  for (const rally of rallies) {
    rally.touches.forEach((touch, i) => {
      if (touch.team !== team || touch.action !== "attack") return;
      let j = i;
      while (j > 0 && rally.touches[j - 1].team === team) j--;
      list.push({ touch, first: j < i ? rally.touches[j] : null });
    });
  }
  return list;
}

// Feld 2/3/4 = vorne, 1/5/6 = hinten (tatsächliche Position bei der Berührung)
function attackPos(touch) {
  if (!touch.courtPos) return null;
  return [2, 3, 4].includes(touch.courtPos) ? String(touch.courtPos) : "back";
}

const goodPass = (t) => t.quality === "#" || t.quality === "+";

// Mittlere Aufschlagwirkung: Rang 0 (Ass) = 100 %, Rang 5 (Fehler) = 0 %
function serveValues(rallies, team) {
  const serves = touchesOf(rallies, team, "serve");
  const sum = serves.reduce((a, t) => a + (5 - rankOf("serve", t.quality)) / 5, 0);
  const errors = serves.filter((t) => t.quality === "=").length;
  return { n: serves.length, errors, errorShare: ratio(errors, serves.length), effect: ratio(sum, serves.length) };
}

function sideOutValues(rallies, team) {
  const received = rallies.filter((r) => r.serving !== team);
  const won = received.filter((r) => r.winner === team).length;
  return { n: received.length, won, share: ratio(won, received.length) };
}

// Ein Punkt des Gegners durch eigenen Fehler? (Fehler-Berührung oder Punktgrund außer "unklar")
function ownFault(rally) {
  if (rally.winner !== OPP) return false;
  if (rally.reason && rally.reason !== "touch" && rally.reason !== "other") return true;
  return rally.touches.some((t) => t.team === OWN && isFault(t.action, t.quality));
}

export function buildBriefing(rallies) {
  const items = [];
  const add = (key, value, n, extra = {}) => {
    if (exceeds(key, value, n)) items.push({ key, value, n, score: score(key, value), ...extra });
  };
  // Häufigster Wert als Merkmal (Anteil)
  const addTop = (key, values) => {
    const top = topShare(values);
    if (top) add(key, top.count / top.n, top.n, { subject: top.key, count: top.count });
  };

  /* --- Gegner --- */
  const oppAttacks = attacksWithFirst(rallies, OPP);
  addTop("oppAttackPosPoor", oppAttacks.filter((a) => a.first && a.first.quality !== "#").map((a) => attackPos(a.touch)));
  addTop("oppAttackPosGood", oppAttacks.filter((a) => a.first?.quality === "#").map((a) => attackPos(a.touch)));
  addTop("oppAttackPos", oppAttacks.map((a) => attackPos(a.touch)));
  addTop("oppMainAttacker", oppAttacks.map((a) => a.touch.playerId));
  addTop("oppAttackZone", oppAttacks.map((a) => a.touch.zone && a.touch.zone !== OUT ? coarseZone(a.touch.zone, "target") : null));
  addTop("oppServeTarget", touchesOf(rallies, OWN, "reception").map((t) => t.playerId));

  for (const [id, list] of groupBy(touchesOf(rallies, OPP, "reception"), (t) => t.playerId)) {
    const good = list.filter(goodPass).length;
    add("oppWeakReceiver", good / list.length, list.length, { subject: id, count: good });
  }

  // Gegner-Aufschläger: Ass oder eigene Annahme Rang 3–5 (− ✖ ⚠); Aufschlagfehler zählen nicht
  const served = rallies.filter((r) => r.serving === OPP && r.server).map((r) => {
    const serve = r.touches.find((t) => t.team === OPP && t.action === "serve");
    const reception = r.touches.find((t) => t.team === OWN && t.action === "reception");
    if (serve?.quality === "=" || (!serve && !reception)) return null;
    return { server: r.server, bad: serve?.quality === "#" || (reception ? rankOf("reception", reception.quality) >= 3 : false) };
  }).filter(Boolean);
  for (const [id, list] of groupBy(served, (s) => s.server)) {
    const bad = list.filter((s) => s.bad).length;
    add("oppStrongServer", bad / list.length, list.length, { subject: id, count: bad });
  }

  // Punkte des Gegners in Folge, am Ende (= gerade jetzt)
  let run = 0;
  for (let i = rallies.length - 1; i >= 0 && rallies[i].winner === OPP; i--) run++;
  add("oppRun", run, run, { count: run });

  /* --- Eigenes Team --- */
  for (const [id, list] of groupBy(touchesOf(rallies, OWN, "reception"), (t) => t.playerId)) {
    const good = list.filter(goodPass).length;
    add("ownWeakReceiver", good / list.length, list.length, { subject: id, count: good });
  }
  const ownAttacks = touchesOf(rallies, OWN, "attack");
  for (const [id, list] of groupBy(ownAttacks, (t) => t.playerId)) {
    const kills = list.filter((t) => t.quality === "#").length;
    const errors = list.filter((t) => t.quality === "=").length;
    add("ownWeakAttacker", (kills - errors) / list.length, list.length, { subject: id, count: kills - errors });
  }
  const blocked = ownAttacks.filter((t) => t.quality === "/").length;
  add("ownBlocked", ratio(blocked, ownAttacks.length), ownAttacks.length, { count: blocked });

  const breaks = rallies.filter((r) => r.serving === OWN);
  const breaksWon = breaks.filter((r) => r.winner === OWN).length;
  add("ownBreak", ratio(breaksWon, breaks.length), breaks.length, { count: breaksWon });

  const oppPoints = rallies.filter((r) => r.winner === OPP);
  const faults = oppPoints.filter(ownFault).length;
  add("ownFaultShare", ratio(faults, oppPoints.length), oppPoints.length, { count: faults });

  // Rotation = wer bei uns auf Position 1 stand
  for (const [id, list] of groupBy(rallies, (r) => r.ownLineup?.[0])) {
    const won = list.filter((r) => r.winner === OWN).length;
    add("ownRotation", list.length - 2 * won, list.length, { subject: id, count: list.length - 2 * won });
  }

  items.sort((a, b) => b.score - a.score);
  return {
    values: {
      own: { sideOut: sideOutValues(rallies, OWN), serve: serveValues(rallies, OWN) },
      opp: { sideOut: sideOutValues(rallies, OPP), serve: serveValues(rallies, OPP) },
    },
    items: items.slice(0, MAX_ITEMS),
  };
}
