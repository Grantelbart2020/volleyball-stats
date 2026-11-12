/*
  rules.js – die Volleyball-Regeln als reine Funktionen.

  "Rein" heißt: Diese Datei kennt weder Bildschirm noch Datenbank. Jede Funktion
  bekommt Werte und gibt ein Ergebnis zurück, wie eine Python-Funktion
  def rotate(lineup): return ...
  Deshalb lassen sich die Regeln automatisch testen (tests/rules.test.mjs).

  Grundidee: Gespeichert werden nur EREIGNISSE eines Spiels, der Reihe nach:
    { type: "setStart", setNumber, firstServe, lineup: { own, opp }, liberoPartners: { own, opp } }
    { type: "point", winner }                                  winner: "own" | "opp"
    { type: "substitution", team, outId, inId, exceptional }   Auswechslung
    { type: "liberoSwap", team, outId, inId }                  Libero-Tausch
  Den aktuellen Stand (Spielstand, wer wo steht, wie viele Wechsel ...) rechnet
  computeMatch() jedes Mal aus dieser Liste neu aus, wie eine Excel-Formel aus
  ihren Zeilen. "Rückgängig" heißt dann einfach: letztes Ereignis löschen.

  Aufstellung (lineup): Liste mit 6 Spieler-ids, Index 0 = Position 1 (Aufschlag),
  Index 1 = Position 2, ... Index 5 = Position 6.
      Netz
    4  3  2      vorne:  Index 3, 2, 1
    5  6  1      hinten: Index 4, 5, 0
*/

export const OWN = "own";
export const OPP = "opp";
export const TEAMS = [OWN, OPP];

export function otherTeam(team) {
  return team === OWN ? OPP : OWN;
}

/* ---------- Regelwerte (einstellbar) ---------- */

export function defaultRules() {
  return {
    setsToWin: 3,          // Gewinnsätze (3 = "best of 5")
    pointsPerSet: 25,      // Punkte für einen normalen Satz
    pointsDecidingSet: 15, // Punkte im Entscheidungssatz
    minLead: 2,            // nötiger Abstand
    maxSubstitutions: 6,   // Auswechslungen pro Team und Satz
    maxPlayers: 14,        // Spielkader höchstens (inkl. Libero)
    maxLiberos: 2,         // Liberos höchstens
  };
}

// Erlaubte Bereiche für die Eingabe der Regelwerte: [kleinster, größter] Wert.
export const RULE_LIMITS = {
  setsToWin: [1, 5],
  pointsPerSet: [5, 99],
  pointsDecidingSet: [5, 99],
  minLead: [1, 10],
  maxSubstitutions: [0, 99],
  maxPlayers: [6, 30],
  maxLiberos: [0, 5],
};

// Ab so vielen Spielern im Kader sollten es genau 2 Liberos sein (nur Warnung).
export const TWO_LIBEROS_ABOVE = 12;

/* ---------- Saison ---------- */

/*
  Saison zu einem Datum, z. B. 12.11.2026 -> "2026/27".
  Annahme: Eine Saison beginnt im Juli. Vorher gilt noch die Vorjahressaison.
*/
export function seasonForDate(date) {
  const startYear = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1; // Monat 6 = Juli
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/* ---------- Spielkader ---------- */

/*
  Prüft den eigenen Spielkader.
  errors   = harte Grenze, so darf nicht gespeichert werden
  warnings = Hinweis, Speichern trotzdem möglich
*/
export function checkOwnRoster(players, rules) {
  const liberos = players.filter((p) => p.isLibero).length;
  const errors = [];
  const warnings = [];
  if (players.length > rules.maxPlayers) errors.push("rosterTooMany");
  if (liberos > rules.maxLiberos) errors.push("tooManyLiberos");
  if (players.length > TWO_LIBEROS_ABOVE && liberos < 2) warnings.push("needTwoLiberos");
  return { errors, warnings };
}

/* ---------- Satz ---------- */

// Der letzte mögliche Satz ist der Entscheidungssatz (bei 3 Gewinnsätzen: Satz 5).
export function isDecidingSet(setNumber, rules) {
  return rules.setsToWin > 1 && setNumber === rules.setsToWin * 2 - 1;
}

export function pointsToWin(setNumber, rules) {
  return isDecidingSet(setNumber, rules) ? rules.pointsDecidingSet : rules.pointsPerSet;
}

// Gewinner des Satzes oder null, wenn er noch läuft.
export function setWinner(score, target, minLead) {
  for (const team of TEAMS) {
    if (score[team] >= target && score[team] - score[otherTeam(team)] >= minLead) return team;
  }
  return null;
}

/*
  Wer schlägt in Satz n zuerst auf?
  Satz 1 und Entscheidungssatz: wird ausgelost -> null (App muss fragen).
  Sonst: das Team, das im vorigen Satz NICHT zuerst aufgeschlagen hat.
*/
export function suggestedFirstServe(setNumber, sets, rules) {
  if (setNumber === 1 || isDecidingSet(setNumber, rules)) return null;
  const previous = sets[setNumber - 2];
  return previous ? otherTeam(previous.firstServe) : null;
}

/* ---------- Rotation ---------- */

export function isFrontRow(index) {
  return index >= 1 && index <= 3; // Positionen 2, 3, 4
}

export const BACK_ROW = [0, 4, 5]; // Positionen 1, 5, 6

/*
  Rotation im Uhrzeigersinn: Position 2 geht auf 1 (und schlägt auf),
  1 auf 6, 6 auf 5, 5 auf 4, 4 auf 3, 3 auf 2.
  Also: neue Position i bekommt den Spieler von der alten Position i+1.
*/
export function rotate(lineup) {
  return lineup.map((_, i) => lineup[(i + 1) % 6]);
}

/*
  Prüft eine Startaufstellung: 6 verschiedene erlaubte Spieler.
  Gibt einen Fehlercode zurück oder null, wenn alles passt.
*/
export function lineupError(lineup, allowedIds) {
  if (!Array.isArray(lineup) || lineup.length !== 6 || lineup.some((id) => !id)) return "lineupIncomplete";
  if (new Set(lineup).size !== 6) return "lineupDuplicate";
  if (lineup.some((id) => !allowedIds.includes(id))) return "lineupInvalid";
  return null;
}

/* ---------- Stand eines Satzes berechnen ---------- */

function newTeamState(lineup, liberoIds, partners) {
  return {
    lineup: lineup ? [...lineup] : null,   // wer gerade wo steht (null = nicht erfasst)
    starters: lineup ? [...lineup] : null, // Startaufstellung, für die Wechselregeln
    liberoIds: [...liberoIds],
    libero: null,          // { liberoId, replacedId }, wenn ein Libero auf dem Feld ist
    lastLiberoId: null,    // zuletzt eingesetzter Libero (für den Vorschlag)
    partners: [...(partners ?? [])], // für wen der Libero normalerweise kommt
    subs: [],              // alle Auswechslungen dieses Satzes
    subCount: 0,           // zählende Auswechslungen
    liberoSwapped: false,  // in dieser Pause schon ein Libero-Tausch?
  };
}

export function startSet(event, rules, liberoIds) {
  return {
    number: event.setNumber,
    target: pointsToWin(event.setNumber, rules),
    minLead: rules.minLead,
    firstServe: event.firstServe,
    serving: event.firstServe,
    score: { own: 0, opp: 0 },
    rallies: 0,
    winner: null,
    teams: {
      own: newTeamState(event.lineup.own, liberoIds.own, event.liberoPartners?.own),
      opp: newTeamState(event.lineup.opp, liberoIds.opp, event.liberoPartners?.opp),
    },
  };
}

/*
  Wendet ein Ereignis auf den Stand eines Satzes an und gibt den NEUEN Stand
  zurück. Der alte bleibt unverändert (structuredClone = tiefe Kopie, wie
  copy.deepcopy in Python). Geprüft wird hier nicht, das passiert vorher.
*/
export function applyEvent(set, event) {
  const s = structuredClone(set);
  if (event.type === "point") applyPoint(s, event.winner);
  else if (event.type === "substitution") applySubstitution(s.teams[event.team], event);
  else if (event.type === "liberoSwap") applyLiberoSwap(s.teams[event.team], event);
  return s;
}

function applyPoint(s, winner) {
  s.score[winner] += 1;
  s.rallies += 1;
  for (const team of TEAMS) s.teams[team].liberoSwapped = false; // neue Pause
  // Seitenwechsel beim Aufschlag ("Side-out"): Wer den Aufschlag zurückholt, rotiert.
  if (winner !== s.serving) {
    const ts = s.teams[winner];
    if (ts.lineup) ts.lineup = rotate(ts.lineup);
    s.serving = winner;
  }
  s.winner = setWinner(s.score, s.target, s.minLead);
}

function applySubstitution(ts, { outId, inId, exceptional }) {
  ts.lineup[ts.lineup.indexOf(outId)] = inId;
  ts.subs.push({ outId, inId, exceptional: Boolean(exceptional) });
  if (!exceptional) ts.subCount += 1;
  // Der Eingewechselte übernimmt die Libero-Partnerschaft des Ausgewechselten.
  ts.partners = ts.partners.map((id) => (id === outId ? inId : id));
}

function applyLiberoSwap(ts, { outId, inId }) {
  const index = ts.lineup.indexOf(outId);
  ts.lineup[index] = inId;
  if (ts.libero && outId === ts.libero.liberoId) {
    // Libero geht raus: entweder der ersetzte Spieler kommt zurück oder der zweite Libero.
    ts.libero = inId === ts.libero.replacedId ? null : { liberoId: inId, replacedId: ts.libero.replacedId };
  } else {
    ts.libero = { liberoId: inId, replacedId: outId };
  }
  if (ts.libero) ts.lastLiberoId = ts.libero.liberoId;
  ts.liberoSwapped = true;
}

/* ---------- Stand des ganzen Spiels ---------- */

/*
  Rechnet aus allen Ereignissen den Stand des Spiels aus.
  players: Spielkader beider Teams (für die Liberos), events: nach Reihenfolge sortiert.
*/
export function computeMatch(rules, players, events) {
  const liberoIds = {
    own: players.filter((p) => p.side === OWN && p.isLibero).map((p) => p.id),
    opp: players.filter((p) => p.side === OPP && p.isLibero).map((p) => p.id),
  };
  const sets = [];
  for (const event of events) {
    if (event.type === "setStart") sets.push(startSet(event, rules, liberoIds));
    else if (sets.length) sets[sets.length - 1] = applyEvent(sets[sets.length - 1], event);
  }
  const setsWon = { own: 0, opp: 0 };
  for (const set of sets) if (set.winner) setsWon[set.winner] += 1;
  const matchOver = setsWon.own >= rules.setsToWin || setsWon.opp >= rules.setsToWin;
  const last = sets[sets.length - 1];
  const activeSet = last && !last.winner ? last : null;
  const nextSetNumber = activeSet || matchOver ? null : sets.length + 1;
  return { sets, setsWon, matchOver, activeSet, nextSetNumber, liberoIds };
}

/*
  Prüft einen Satzstart. Gibt einen Fehlercode zurück oder null.
  players: Spielkader beider Teams.
*/
export function setStartError(matchState, event, players) {
  if (matchState.matchOver) return "matchOver";
  if (matchState.activeSet) return "setRunning";
  if (event.setNumber !== matchState.nextSetNumber) return "wrongSet";
  if (!TEAMS.includes(event.firstServe)) return "firstServeMissing";

  const regular = (side) => players.filter((p) => p.side === side && !p.isLibero).map((p) => p.id);
  if (players.filter((p) => p.side === OPP).length < 6) return "opponentRosterTooSmall";

  const ownError = lineupError(event.lineup.own, regular(OWN));
  if (ownError) return ownError;
  if (event.lineup.opp) {
    const oppError = lineupError(event.lineup.opp, regular(OPP));
    if (oppError) return oppError;
  }
  for (const team of TEAMS) {
    const partners = event.liberoPartners?.[team] ?? [];
    if (partners.some((id) => !(event.lineup[team] ?? []).includes(id))) return "partnerInvalid";
  }
  return null;
}

/* ---------- Libero ---------- */

/*
  Muss der Libero raus? Ja, wenn er nach vorne rotiert ist (Positionen 2-4)
  oder – zur Sicherheit – wenn er aufschlagen müsste. Dann kommt der
  ersetzte Spieler zurück.
*/
export function requiredLiberoExit(set, team) {
  const ts = set.teams[team];
  if (!ts.lineup || !ts.libero) return null;
  const index = ts.lineup.indexOf(ts.libero.liberoId);
  if (isFrontRow(index) || (index === 0 && set.serving === team)) {
    return { team, outId: ts.libero.liberoId, inId: ts.libero.replacedId, mandatory: true };
  }
  return null;
}

/*
  Alle erlaubten Libero-Täusche eines Teams in der aktuellen Pause.
  Regeln:
  - Libero nur für Hinterspieler (Positionen 1, 5, 6), nie für den Aufschläger.
  - Der Libero kann nur durch den ersetzten Spieler oder den zweiten Libero abgelöst werden.
  - Zwischen zwei Libero-Täuschen muss ein Ballwechsel liegen.
*/
export function validLiberoSwaps(set, team) {
  const ts = set.teams[team];
  if (!ts.lineup || ts.liberoIds.length === 0 || set.winner) return [];

  const required = requiredLiberoExit(set, team);
  if (required) return [{ outId: required.outId, inId: required.inId }];
  if (ts.liberoSwapped) return [];

  if (ts.libero) {
    const options = [{ outId: ts.libero.liberoId, inId: ts.libero.replacedId }];
    for (const liberoId of ts.liberoIds) {
      if (liberoId !== ts.libero.liberoId) options.push({ outId: ts.libero.liberoId, inId: liberoId });
    }
    return options;
  }

  const options = [];
  for (const index of BACK_ROW) {
    if (index === 0 && set.serving === team) continue; // Aufschläger bleibt drin
    for (const liberoId of ts.liberoIds) options.push({ outId: ts.lineup[index], inId: liberoId });
  }
  return options;
}

export function liberoSwapError(set, team, outId, inId) {
  const allowed = validLiberoSwaps(set, team).some((o) => o.outId === outId && o.inId === inId);
  return allowed ? null : "liberoSwapInvalid";
}

/*
  Vorschlag für die Pause: Pflicht-Tausch, wenn der Libero raus muss,
  sonst Libero rein für einen Libero-Partner, der hinten steht.
*/
export function suggestLiberoSwap(set, team) {
  const required = requiredLiberoExit(set, team);
  if (required) return required;
  const ts = set.teams[team];
  if (ts.libero) return null;
  const preferred = ts.lastLiberoId ?? ts.liberoIds[0];
  const option = validLiberoSwaps(set, team).find((o) => ts.partners.includes(o.outId) && o.inId === preferred);
  return option ? { team, ...option, mandatory: false } : null;
}

/* ---------- Ballwechsel ---------- */

// Darf der nächste Ballwechsel gespielt (ein Punkt eingetragen) werden?
export function rallyError(set) {
  if (!set) return "noActiveSet";
  if (set.winner) return "setOver";
  if (TEAMS.some((team) => requiredLiberoExit(set, team))) return "liberoMustExit";
  return null;
}

/* ---------- Auswechslung ---------- */

/*
  Prüft eine Auswechslung. Gibt einen Fehlercode zurück oder null.
  teamPlayerIds: alle Spieler dieses Teams im Spielkader.
  Regeln:
  - höchstens maxSubstitutions pro Satz (Ausnahmewechsel zählen nicht)
  - Libero wird nicht ausgewechselt, sondern getauscht
  - Ein Startspieler darf einmal raus und einmal zurück, nur für "seinen" Einwechselspieler.
  - Ein Einwechselspieler darf einmal rein und nur gegen "seinen" Startspieler raus.
  - Ausnahmewechsel (Verletzung): jeder Spieler, der nicht auf dem Feld steht.
*/
export function substitutionError(set, team, { outId, inId, exceptional }, rules, teamPlayerIds) {
  const ts = set.teams[team];
  if (!ts.lineup) return "noLineup";
  if (set.winner) return "setOver";
  if (!ts.lineup.includes(outId)) return "notOnCourt";
  if (ts.liberoIds.includes(outId) || ts.liberoIds.includes(inId)) return "liberoNoSub";
  if (!teamPlayerIds.includes(inId)) return "notInRoster";
  if (ts.lineup.includes(inId) || ts.libero?.replacedId === inId) return "alreadyOnCourt";
  if (exceptional) return null;
  if (ts.subCount >= rules.maxSubstitutions) return "subLimit";

  const regular = ts.subs.filter((s) => !s.exceptional);
  if (ts.starters.includes(outId)) {
    if (regular.some((s) => s.outId === outId)) return "starterAlreadyOut";
    const inUsed = ts.starters.includes(inId) || regular.some((s) => s.inId === inId || s.outId === inId);
    return inUsed ? "subAlreadyUsed" : null;
  }
  const cameInFor = regular.find((s) => s.inId === outId);
  if (cameInFor) return inId === cameInFor.outId ? null : "mustReturnStarter";
  return "notAllowed";
}

/* ---------- Jedes Ereignis prüfen ---------- */

/*
  Prüft ein neues Ereignis gegen den aktuellen Stand des Spiels.
  Gibt einen Fehlercode zurück oder null. Wird direkt vor dem Speichern
  aufgerufen, z. B. damit ein doppeltes Antippen keinen Satz zweimal startet.
*/
export function eventError(matchState, event, players, rules) {
  if (event.type === "setStart") return setStartError(matchState, event, players);
  const set = matchState.activeSet;
  if (!set) return "noActiveSet";
  if (event.type === "point") return rallyError(set);
  if (event.type === "substitution") {
    const teamIds = players.filter((p) => p.side === event.team).map((p) => p.id);
    return substitutionError(set, event.team, event, rules, teamIds);
  }
  if (event.type === "liberoSwap") return liberoSwapError(set, event.team, event.outId, event.inId);
  return "unknownEvent";
}
