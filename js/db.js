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

  Jeder Eintrag hat eine eindeutige id und Zeitstempel. Das brauchen wir
  später für Export/Import und einen möglichen Abgleich zwischen Geräten.
*/

const DB_NAME = "vbstats";
const DB_VERSION = 1; // bei Änderungen am Aufbau erhöhen (siehe onupgradeneeded)

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
        // Spätere Versionen: hier "if (event.oldVersion < 2) { ... }" ergänzen.
      };

      request.onsuccess = () => resolve(request.result);
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

// Löscht ein Team und alle seine Kader-Einträge. Personen bleiben erhalten.
export function deleteTeam(id) {
  return run(["teams", "rosterEntries"], "readwrite", (s) => {
    s.teams.delete(id);
    const cursorRequest = s.rosterEntries.index("byTeamSeason").openCursor(teamRange(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
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
