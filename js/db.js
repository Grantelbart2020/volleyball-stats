/*
  db.js – die lokale Datenbank der App.

  NUR diese Datei spricht mit der Datenbank. Alle anderen Dateien rufen die
  Funktionen hier auf (z. B. db.listTeams()). So steht jede Datenbank-Logik
  an genau einer Stelle.

  Technik: IndexedDB, eine Datenbank, die in jeden Browser eingebaut ist.
  Die Daten liegen nur auf diesem Gerät und funktionieren ohne Internet.

  Aufbau (wie Tabellen in Excel, hier "Object Stores" genannt):
    teams          { id, name, createdAt, updatedAt }
    persons        { id, name, createdAt, updatedAt }
                   -> eine Person bleibt über alle Saisons dieselbe (feste id)
    rosterEntries  { id, teamId, season, personId, number, createdAt, updatedAt }
                   -> Saison-Kader: "Person X spielt in Saison Y für Team Z mit Nummer N"
  ab Version 2:
    matches        { id, teamId, season, date, opponent, homeAway, competition, note,
                     rules, ownSideTop, createdAt, updatedAt }
                   -> ein Spiel; rules = Regelwerte für genau dieses Spiel
    matchPlayers   { id, matchId, side, personId, number, name, isLibero, createdAt, updatedAt }
                   -> Spielkader beider Teams. side "own": personId aus dem Saison-Kader,
                      side "opp": Gegner mit Nummer und optionalem Namen
    matchEvents    { id, matchId, seq, type, ..., createdAt }
                   -> Ereignisse des Spiels der Reihe nach (seq = 1, 2, 3 ...),
                      z. B. Satzstart, Punkt, Wechsel. Den Stand berechnet rules.js.

  Jeder Eintrag hat eine eindeutige id und Zeitstempel. Das brauchen wir
  später für Export/Import und einen möglichen Abgleich zwischen Geräten.
*/

const DB_NAME = "vbstats";
const DB_VERSION = 2; // bei Änderungen am Aufbau erhöhen (siehe onupgradeneeded)

/* ---------- Hilfsfunktionen ---------- */

/*
  Erzeugt eine eindeutige id.
  crypto.randomUUID gibt es nur auf sicheren Adressen (https, localhost).
  Beim Testen übers WLAN (http://192...) fehlt es, dann bauen wir die id selbst.
*/
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function now() {
  return new Date().toISOString(); // z. B. "2026-11-12T18:40:00.000Z"
}

// Sortiert Texte nach deutschem Alphabet (Ä bei A usw.), Groß/klein egal.
const byName = (a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" });

/* ---------- Verbindung zur Datenbank ---------- */

let dbPromise = null;

function openDb() {
  // Nur einmal öffnen und danach dieselbe Verbindung wiederverwenden.
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // Läuft nur beim allerersten Start oder wenn DB_VERSION erhöht wurde.
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (event.oldVersion < 1) {
          db.createObjectStore("teams", { keyPath: "id" });
          db.createObjectStore("persons", { keyPath: "id" });
          const roster = db.createObjectStore("rosterEntries", { keyPath: "id" });
          // Indizes = schnelle Suche, z. B. "alle Einträge von Team X in Saison Y"
          roster.createIndex("byTeamSeason", ["teamId", "season"]);
          roster.createIndex("byPerson", "personId");
        }
        // Version 2 (Meilenstein 3): Spiele. Bestehende Teams und Kader bleiben unverändert.
        if (event.oldVersion < 2) {
          const matches = db.createObjectStore("matches", { keyPath: "id" });
          matches.createIndex("byTeamSeason", ["teamId", "season"]);
          const matchPlayers = db.createObjectStore("matchPlayers", { keyPath: "id" });
          matchPlayers.createIndex("byMatch", "matchId");
          const matchEvents = db.createObjectStore("matchEvents", { keyPath: "id" });
          matchEvents.createIndex("byMatch", "matchId");
        }
        // Spätere Versionen: hier "if (event.oldVersion < 3) { ... }" ergänzen.
      };

      // Die App ist in einem anderen Tab noch mit der alten Version offen.
      request.onblocked = () => {
        console.warn("Datenbank-Update wartet: Bitte andere Tabs dieser App schließen.");
      };

      request.onsuccess = () => {
        const db = request.result;
        // Will ein neuerer Tab die Datenbank aktualisieren, geben wir sie frei.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

/*
  Führt Arbeit in einer "Transaktion" aus. Eine Transaktion bündelt mehrere
  Schritte: Entweder klappen alle, oder keiner wird gespeichert.
  So entsteht nie ein halber Zustand (z. B. Team gelöscht, Kader aber noch da).

  work(stores) bekommt die Stores und gibt eine Anfrage oder ein Objekt mit
  Anfragen zurück. Wenn die Transaktion fertig ist, kommen deren Ergebnisse zurück.
*/
async function run(storeNames, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const names = [].concat(storeNames);
    const transaction = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, transaction.objectStore(n)]));

    let value;
    try {
      value = work(stores);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    const unwrap = (v) => (v instanceof IDBRequest ? v.result : v);
    transaction.oncomplete = () => {
      if (value && !(value instanceof IDBRequest) && typeof value === "object" && !Array.isArray(value)) {
        resolve(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)])));
      } else {
        resolve(unwrap(value));
      }
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaktion abgebrochen"));
  });
}

// Bereich im Index "byTeamSeason": alle Saisons eines Teams.
function teamRange(teamId) {
  return IDBKeyRange.bound([teamId, ""], [teamId, "￿"]);
}

// Löscht innerhalb einer Transaktion alle Einträge, die im Index zum Schlüssel passen.
function deleteWhere(store, indexName, key) {
  const cursorRequest = store.index(indexName).openCursor(key);
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
}

/* ---------- Dauerhafte Speicherung ---------- */

/*
  Bittet den Browser, die Daten nicht automatisch zu löschen, wenn der
  Speicher knapp wird. Der Browser kann ablehnen. Das senkt das Risiko,
  ersetzt aber keine Sicherung per Export.
*/
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

/* ---------- Teams ---------- */

export async function listTeams() {
  const teams = await run("teams", "readonly", (s) => s.teams.getAll());
  return teams.sort(byName);
}

export function getTeam(id) {
  return run("teams", "readonly", (s) => s.teams.get(id));
}

// Legt ein Team an (ohne id) oder ändert es (mit id). Gibt das Team zurück.
export async function saveTeam({ id, name }) {
  const existing = id ? await getTeam(id) : null;
  const team = existing
    ? { ...existing, name, updatedAt: now() }
    : { id: newId(), name, createdAt: now(), updatedAt: now() };
  await run("teams", "readwrite", (s) => s.teams.put(team));
  return team;
}

// Löscht ein Team, seine Kader-Einträge und seine Spiele. Personen bleiben erhalten.
export function deleteTeam(id) {
  const stores = ["teams", "rosterEntries", "matches", "matchPlayers", "matchEvents"];
  return run(stores, "readwrite", (s) => {
    s.teams.delete(id);
    deleteWhere(s.rosterEntries, "byTeamSeason", teamRange(id));
    const cursorRequest = s.matches.index("byTeamSeason").openCursor(teamRange(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        deleteWhere(s.matchPlayers, "byMatch", cursor.value.id);
        deleteWhere(s.matchEvents, "byMatch", cursor.value.id);
        cursor.delete();
        cursor.continue();
      }
    };
  });
}

/* ---------- Saisons ---------- */

// Alle Saisons, für die das Team einen Kader hat, neueste zuerst.
export async function listSeasons(teamId) {
  const entries = await run("rosterEntries", "readonly", (s) =>
    s.rosterEntries.index("byTeamSeason").getAll(teamRange(teamId))
  );
  return [...new Set(entries.map((e) => e.season))].sort().reverse();
}

/* ---------- Personen ---------- */

export async function listPersons() {
  const persons = await run("persons", "readonly", (s) => s.persons.getAll());
  return persons.sort(byName);
}

/* ---------- Saison-Kader ---------- */

/*
  Kader eines Teams in einer Saison, nach Nummer sortiert.
  Jeder Eintrag enthält zusätzlich "name" aus der Person.
*/
export async function listRoster(teamId, season) {
  const { entries, persons } = await run(["rosterEntries", "persons"], "readonly", (s) => ({
    entries: s.rosterEntries.index("byTeamSeason").getAll([teamId, season]),
    persons: s.persons.getAll(),
  }));
  const personById = new Map(persons.map((p) => [p.id, p]));
  return entries
    .map((entry) => ({ ...entry, name: personById.get(entry.personId)?.name ?? "?" }))
    .sort((a, b) => a.number - b.number);
}

/*
  Fügt eine Person zum Kader hinzu.
  - personId angegeben: bestehende Person
  - sonst: neue Person mit "name" wird angelegt
*/
export function addToRoster({ teamId, season, number, personId, name }) {
  return run(["rosterEntries", "persons"], "readwrite", (s) => {
    let id = personId;
    if (!id) {
      id = newId();
      s.persons.add({ id, name, createdAt: now(), updatedAt: now() });
    }
    s.rosterEntries.add({
      id: newId(), teamId, season, personId: id, number,
      createdAt: now(), updatedAt: now(),
    });
  });
}

// Ändert Nummer (am Kader-Eintrag) und Name (an der Person).
export function updateRosterEntry(entry, { number, name }) {
  return run(["rosterEntries", "persons"], "readwrite", (s) => {
    s.rosterEntries.put({
      id: entry.id, teamId: entry.teamId, season: entry.season, personId: entry.personId,
      number, createdAt: entry.createdAt, updatedAt: now(),
    });
    const personRequest = s.persons.get(entry.personId);
    personRequest.onsuccess = () => {
      const person = personRequest.result;
      if (person && person.name !== name) {
        s.persons.put({ ...person, name, updatedAt: now() });
      }
    };
  });
}

// Entfernt eine Person aus dem Kader. Die Person selbst bleibt erhalten.
export function removeFromRoster(entryId) {
  return run("rosterEntries", "readwrite", (s) => s.rosterEntries.delete(entryId));
}

// Übernimmt den Kader einer Saison (gleiche Personen, gleiche Nummern) in eine neue Saison.
export async function copyRoster(teamId, fromSeason, toSeason) {
  const source = await listRoster(teamId, fromSeason);
  return run("rosterEntries", "readwrite", (s) => {
    for (const entry of source) {
      s.rosterEntries.add({
        id: newId(), teamId, season: toSeason, personId: entry.personId, number: entry.number,
        createdAt: now(), updatedAt: now(),
      });
    }
  });
}

/* ---------- Spiele ---------- */

// Spiele eines Teams in einer Saison, neueste zuerst.
export async function listMatches(teamId, season) {
  const matches = await run("matches", "readonly", (s) =>
    s.matches.index("byTeamSeason").getAll([teamId, season])
  );
  return matches.sort((a, b) => b.date.localeCompare(a.date));
}

export function getMatch(id) {
  return run("matches", "readonly", (s) => s.matches.get(id));
}

// Legt ein Spiel an (ohne id) oder ändert es (mit id). Gibt das Spiel zurück.
export async function saveMatch(data) {
  const existing = data.id ? await getMatch(data.id) : null;
  const match = existing
    ? { ...existing, ...data, updatedAt: now() }
    : { ownSideTop: false, ...data, id: newId(), createdAt: now(), updatedAt: now() };
  await run("matches", "readwrite", (s) => s.matches.put(match));
  return match;
}

// Löscht ein Spiel mit Spielkader und allen Ereignissen.
export function deleteMatch(id) {
  return run(["matches", "matchPlayers", "matchEvents"], "readwrite", (s) => {
    s.matches.delete(id);
    deleteWhere(s.matchPlayers, "byMatch", id);
    deleteWhere(s.matchEvents, "byMatch", id);
  });
}

/* ---------- Spielkader (beide Teams) ---------- */

/*
  Spielkader eines Spiels, nach Nummer sortiert.
  Eigene Spieler bekommen "name" aus der Person, Gegner haben ihren Namen selbst.
*/
export async function listMatchPlayers(matchId) {
  const { players, persons } = await run(["matchPlayers", "persons"], "readonly", (s) => ({
    players: s.matchPlayers.index("byMatch").getAll(matchId),
    persons: s.persons.getAll(),
  }));
  const personById = new Map(persons.map((p) => [p.id, p]));
  return players
    .map((p) => (p.side === "own" ? { ...p, name: personById.get(p.personId)?.name ?? "?" } : p))
    .sort((a, b) => a.number - b.number);
}

// Fügt einen Spieler zum Spielkader hinzu: { matchId, side, personId, number, name, isLibero }
export async function addMatchPlayer(data) {
  const player = {
    personId: null, name: "", isLibero: false, ...data,
    id: newId(), createdAt: now(), updatedAt: now(),
  };
  // Bei eigenen Spielern steht der Name an der Person, nicht doppelt hier.
  if (player.side === "own") delete player.name;
  await run("matchPlayers", "readwrite", (s) => s.matchPlayers.add(player));
  return player;
}

// Ändert z. B. isLibero. Nur die gespeicherten Felder übernehmen (kein "name" bei eigenen).
export async function updateMatchPlayer(id, changes) {
  const existing = await run("matchPlayers", "readonly", (s) => s.matchPlayers.get(id));
  if (!existing) return;
  const updated = { ...existing, ...changes, updatedAt: now() };
  if (updated.side === "own") delete updated.name;
  await run("matchPlayers", "readwrite", (s) => s.matchPlayers.put(updated));
}

export function removeMatchPlayer(id) {
  return run("matchPlayers", "readwrite", (s) => s.matchPlayers.delete(id));
}

/* ---------- Ereignisse eines Spiels ---------- */

export async function listMatchEvents(matchId) {
  const events = await run("matchEvents", "readonly", (s) =>
    s.matchEvents.index("byMatch").getAll(matchId)
  );
  return events.sort((a, b) => a.seq - b.seq);
}

/*
  Hängt ein Ereignis hinten an. Die laufende Nummer (seq) wird in derselben
  Transaktion bestimmt, damit sie sicher eindeutig ist.
*/
export function addMatchEvent(matchId, data) {
  return run("matchEvents", "readwrite", (s) => {
    const request = s.matchEvents.index("byMatch").getAll(matchId);
    request.onsuccess = () => {
      const maxSeq = request.result.reduce((max, e) => Math.max(max, e.seq), 0);
      s.matchEvents.add({ ...data, matchId, seq: maxSeq + 1, id: newId(), createdAt: now() });
    };
  });
}

// "Rückgängig": löscht das letzte Ereignis des Spiels.
export function deleteLastMatchEvent(matchId) {
  return run("matchEvents", "readwrite", (s) => {
    const request = s.matchEvents.index("byMatch").getAll(matchId);
    request.onsuccess = () => {
      if (!request.result.length) return;
      const last = request.result.reduce((a, b) => (b.seq > a.seq ? b : a));
      s.matchEvents.delete(last.id);
    };
  });
}
