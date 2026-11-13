/*
  backup.js – Sicherung (Export) und Import als Datei. Reine Funktionen wie
  rules.js: kennen weder Bildschirm noch Datenbank, deshalb automatisch testbar
  (tests/backup.test.mjs).

  Dateiformat (JSON, sprachneutral: nur Codes und ids, keine übersetzten Texte):
    {
      "format": "vbstats-backup",
      "version": 1,
      "kind": "full" | "match",          ganze Sicherung oder ein einzelnes Spiel
      "exportedAt": "2026-11-13T18:00:00.000Z",
      "data": { teams: [...], persons: [...], rosterEntries: [...],
                matches: [...], matchPlayers: [...], matchEvents: [...] }
    }
  JSON ist ein Textformat für Daten, ähnlich einem Python-dict mit Listen.

  Import = ZUSAMMENFÜHREN, nichts wird gelöscht (planImport):
  - Eintrag fehlt hier -> wird übernommen
  - Eintrag gibt es schon (gleiche id) -> der neuere (updatedAt) gewinnt
  - Ereignisse eines Spiels werden als Ganzes betrachtet: Die Datei darf die
    Ereignisse hier nur fortsetzen (z. B. Spiel auf dem Handy weiter erfasst).
    Wurde dasselbe Spiel auf zwei Geräten verschieden erfasst, bleibt der
    Stand hier und der Konflikt wird gemeldet.
  - Doppelte Trikotnummern (Kader, Spielkader) werden nicht übernommen.
*/

export const BACKUP_FORMAT = "vbstats-backup";
export const BACKUP_VERSION = 1;
export const STORES = ["teams", "persons", "rosterEntries", "matches", "matchPlayers", "matchEvents"];

/* ---------- Export ---------- */

export function buildBackup(data, kind = "full", exportedAt = new Date().toISOString()) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind,
    exportedAt,
    data: Object.fromEntries(STORES.map((store) => [store, data[store] ?? []])),
  };
}

/*
  Teil der Daten für EIN Spiel: das Spiel, sein Spielkader und seine Ereignisse,
  dazu die beteiligten Teams, deren Saison-Kader und die Personen.
  So lässt sich das Spiel auch auf einem Gerät einlesen, das die Teams noch nicht kennt.
*/
export function matchSubset(all, matchId) {
  const match = all.matches.find((m) => m.id === matchId);
  if (!match) return null;
  const teamIds = new Set([match.teamId, match.opponentTeamId].filter(Boolean));
  const rosterEntries = all.rosterEntries.filter((e) => teamIds.has(e.teamId) && e.season === match.season);
  const matchPlayers = all.matchPlayers.filter((p) => p.matchId === matchId);
  const personIds = new Set([...rosterEntries, ...matchPlayers].map((x) => x.personId).filter(Boolean));
  return {
    teams: all.teams.filter((team) => teamIds.has(team.id)),
    persons: all.persons.filter((p) => personIds.has(p.id)),
    rosterEntries,
    matches: [match],
    matchPlayers,
    matchEvents: all.matchEvents.filter((e) => e.matchId === matchId),
  };
}

/* ---------- Datei prüfen ---------- */

/*
  Liest den Text einer Datei. Gibt { backup } oder { error } zurück.
  Fehlercodes: importNotJson, importWrongFormat, importNewerVersion
*/
export function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    return { error: "importNotJson" };
  }
  if (!backup || backup.format !== BACKUP_FORMAT || typeof backup.data !== "object" || !backup.data) {
    return { error: "importWrongFormat" };
  }
  if (typeof backup.version !== "number" || backup.version > BACKUP_VERSION) return { error: "importNewerVersion" };
  for (const store of STORES) {
    const list = backup.data[store] ?? [];
    if (!Array.isArray(list) || list.some((item) => !item || typeof item.id !== "string")) {
      return { error: "importWrongFormat" };
    }
  }
  return { backup };
}

/* ---------- Zusammenführen ---------- */

const newerThan = (a, b) => (a.updatedAt ?? "") > (b.updatedAt ?? "");

/*
  Plant den Import, ohne etwas zu ändern.
  local, incoming: { teams: [...], ... } (alle Stores)
  Gibt zurück:
    put:       { store: [Einträge zum Speichern] }
    stats:     { store: { added, updated, unchanged, skipped } }
    conflicts: [{ type, ... }]  z. B. { type: "matchEvents", matchId }
*/
export function planImport(local, incoming) {
  const put = Object.fromEntries(STORES.map((s) => [s, []]));
  const stats = Object.fromEntries(STORES.map((s) => [s, { added: 0, updated: 0, unchanged: 0, skipped: 0 }]));
  const conflicts = [];

  // Für Prüfungen: Stand NACH dem Import (lokal + schon geplante Einträge)
  const merged = Object.fromEntries(STORES.map((s) => [s, new Map((local[s] ?? []).map((x) => [x.id, x]))]));

  // Eindeutige Nummern: Kader pro Team+Saison, Spielkader pro Spiel+Seite
  const numberKey = {
    rosterEntries: (e) => `${e.teamId}|${e.season}|${e.number}`,
    matchPlayers: (p) => `${p.matchId}|${p.side}|${p.number}`,
  };
  const numberTaken = (store, item) =>
    [...merged[store].values()].some((other) => other.id !== item.id && numberKey[store](other) === numberKey[store](item));

  for (const store of STORES.filter((s) => s !== "matchEvents")) {
    for (const item of incoming[store] ?? []) {
      const existing = merged[store].get(item.id);
      if (existing && !newerThan(item, existing)) {
        stats[store].unchanged += 1;
        continue;
      }
      if (numberKey[store] && numberTaken(store, item)) {
        stats[store].skipped += 1;
        conflicts.push({ type: "number", store, number: item.number });
        continue;
      }
      put[store].push(item);
      merged[store].set(item.id, item);
      stats[store][existing ? "updated" : "added"] += 1;
    }
  }

  // Ereignisse: pro Spiel als Ganzes
  const byMatch = new Map();
  for (const event of incoming.matchEvents ?? []) {
    if (!byMatch.has(event.matchId)) byMatch.set(event.matchId, []);
    byMatch.get(event.matchId).push(event);
  }
  const localEvents = [...merged.matchEvents.values()];
  for (const [matchId, events] of byMatch) {
    const localIds = new Set(localEvents.filter((e) => e.matchId === matchId).map((e) => e.id));
    const incomingIds = new Set(events.map((e) => e.id));
    const newEvents = events.filter((e) => !localIds.has(e.id));
    const localOnly = [...localIds].filter((id) => !incomingIds.has(id));
    if (!newEvents.length) {
      stats.matchEvents.unchanged += events.length;
    } else if (localOnly.length) {
      // beide Seiten haben eigene Ereignisse -> nicht mischen
      stats.matchEvents.skipped += newEvents.length;
      stats.matchEvents.unchanged += events.length - newEvents.length;
      conflicts.push({ type: "matchEvents", matchId });
    } else {
      put.matchEvents.push(...newEvents);
      stats.matchEvents.added += newEvents.length;
      stats.matchEvents.unchanged += events.length - newEvents.length;
    }
  }

  return { put, stats, conflicts };
}

// Gibt es überhaupt etwas zu speichern?
export function planIsEmpty(plan) {
  return STORES.every((s) => plan.put[s].length === 0);
}
