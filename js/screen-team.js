/*
  screen-team.js – ein Team: umbenennen, löschen, Saison wählen, Spiele, Kader pflegen.
  Adresse: #/team/<id>
*/
import { el, confirmButton, showError } from "./dom.js";
import { t } from "./i18n.js";
import * as db from "./db.js";
import { computeMatch, seasonForDate } from "./rules.js";
import { formatDate, matchResultText } from "./match-format.js";

// Merkt sich pro Team die gewählte Saison, solange die App offen ist.
const selectedSeasonByTeam = new Map();

// Welcher Kader-Eintrag gerade bearbeitet wird (null = keiner).
let editingEntryId = null;

// Aktuelle Saison, z. B. "2026/27" (Beginn im Juli, siehe rules.js).
function currentSeason() {
  return seasonForDate(new Date());
}

// Prüft eine eingegebene Saison wie "2027/28" (zweites Jahr = erstes + 1).
function isValidSeason(text) {
  const match = /^(\d{4})\/(\d{2})$/.exec(text);
  return Boolean(match) && (Number(match[1]) + 1) % 100 === Number(match[2]);
}

// Prüft eine Trikotnummer: ganze Zahl von 0 bis 99. Gibt die Zahl oder null zurück.
function parseNumber(text) {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  return Number(text);
}

export async function renderTeam(container, teamId) {
  const rerender = () => renderTeam(container, teamId);
  const backLink = el("a", { class: "back-link", href: "#/" }, `← ${t("nav.teams")}`);

  const team = await db.getTeam(teamId);
  if (!team) {
    container.replaceChildren(backLink, el("section", { class: "card" }, el("p", {}, t("team.notFound"))));
    return;
  }

  // Saison bestimmen: zuletzt gewählte, sonst neueste mit Kader, sonst aktuelle
  const seasons = await db.listSeasons(teamId);
  const season = selectedSeasonByTeam.get(teamId) ?? seasons[0] ?? currentSeason();
  selectedSeasonByTeam.set(teamId, season);
  const allSeasons = [...new Set([...seasons, season])].sort().reverse();

  const roster = await db.listRoster(teamId, season);
  const persons = await db.listPersons();
  const matches = await db.listMatches(teamId, season);
  // Für das Ergebnis (z. B. 3:1) braucht jedes Spiel seine Ereignisse.
  const results = await Promise.all(matches.map(async (match) =>
    computeMatch(match.rules, [], await db.listMatchEvents(match.id))));

  container.replaceChildren(
    backLink,
    teamHeaderCard(team, rerender),
    seasonCard(teamId, season, allSeasons, roster, rerender),
    matchesCard(teamId, season, matches, results),
    rosterCard(teamId, season, roster, persons, rerender),
  );
}

/* ---------- Karte: Spiele dieser Saison ---------- */

function matchesCard(teamId, season, matches, results) {
  const list = matches.length
    ? el("ul", { class: "list" }, matches.map((match, i) =>
        el("li", {}, el("a", { class: "list-link match-link", href: `#/match/${match.id}` },
          el("span", {}, match.opponent),
          el("span", { class: "muted small" }, formatDate(match.date)),
          el("span", { class: "match-result" }, matchResultText(results[i])),
        ))))
    : el("p", { class: "muted" }, t("matches.empty"));

  return el("section", { class: "card" },
    el("h3", {}, `${t("matches.title")} ${season}`),
    list,
    el("a", { class: "btn btn-primary", href: `#/team/${teamId}/match/new` }, t("match.new")),
  );
}

/* ---------- Karte 1: Teamname, umbenennen, löschen ---------- */

function teamHeaderCard(team, rerender) {
  const nameInput = el("input", { type: "text", maxLength: 60, value: team.name, required: true });
  const error = el("p", { class: "form-error", hidden: true });

  const renameForm = el("form", {
    class: "form-row",
    hidden: true,
    onSubmit: async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return showError(error, t("error.nameRequired"));
      await db.saveTeam({ id: team.id, name });
      rerender();
    },
  },
    nameInput,
    el("button", { type: "submit", class: "btn btn-primary" }, t("common.save")),
  );

  const renameButton = el("button", {
    type: "button", class: "btn",
    onClick: () => { renameForm.hidden = !renameForm.hidden; nameInput.focus(); },
  }, t("team.rename"));

  const deleteButton = confirmButton(t("team.delete"), t("common.reallyDelete"), async () => {
    await db.deleteTeam(team.id);
    location.hash = "#/";
  });

  return el("section", { class: "card" },
    el("h2", {}, team.name),
    el("div", { class: "row-actions" }, renameButton, deleteButton),
    renameForm,
    error,
  );
}

/* ---------- Karte 2: Saison wählen oder neu anlegen ---------- */

function seasonCard(teamId, season, allSeasons, roster, rerender) {
  const select = el("select", {
    onChange: () => { selectedSeasonByTeam.set(teamId, select.value); editingEntryId = null; rerender(); },
  }, allSeasons.map((s) => el("option", { value: s, selected: s === season }, s)));

  const seasonInput = el("input", { type: "text", placeholder: "2027/28", maxLength: 7, inputMode: "numeric" });
  const copyCheckbox = el("input", { type: "checkbox", checked: roster.length > 0 });
  const error = el("p", { class: "form-error", hidden: true });

  const newSeasonForm = el("form", {
    class: "form-row",
    onSubmit: async (event) => {
      event.preventDefault();
      const newSeason = seasonInput.value.trim();
      if (!isValidSeason(newSeason)) return showError(error, t("error.seasonFormat"));
      if (allSeasons.includes(newSeason)) return showError(error, t("error.seasonExists"));
      if (copyCheckbox.checked && roster.length > 0) {
        await db.copyRoster(teamId, season, newSeason);
      }
      selectedSeasonByTeam.set(teamId, newSeason);
      rerender();
    },
  },
    seasonInput,
    el("button", { type: "submit", class: "btn" }, t("season.create")),
  );

  return el("section", { class: "card" },
    el("h3", {}, t("season.title")),
    el("label", { class: "field" }, el("span", {}, t("season.select")), select),
    el("h3", {}, t("season.new")),
    newSeasonForm,
    // Übernehmen nur anbieten, wenn es überhaupt etwas zu übernehmen gibt
    roster.length > 0 && el("label", { class: "checkbox" }, copyCheckbox, ` ${t("season.copyFrom")} ${season}`),
    error,
  );
}

/* ---------- Karte 3: Kader dieser Saison ---------- */

function rosterCard(teamId, season, roster, persons, rerender) {
  const rows = roster.length
    ? el("ul", { class: "roster" }, roster.map((entry) =>
        entry.id === editingEntryId
          ? rosterEditRow(entry, roster, rerender)
          : rosterRow(entry, rerender)))
    : el("p", { class: "muted" }, t("roster.empty"));

  return el("section", { class: "card" },
    el("h3", {}, `${t("roster.title")} ${season} (${roster.length})`),
    rows,
    el("h3", {}, t("roster.add")),
    addPlayerForm(teamId, season, roster, persons, rerender),
  );
}

// Eine Zeile im Kader: Nummer, Name, Bearbeiten, Entfernen
function rosterRow(entry, rerender) {
  return el("li", { class: "roster-row" },
    el("span", { class: "roster-number" }, entry.number),
    el("span", { class: "roster-name" }, entry.name),
    el("span", { class: "row-actions" },
      el("button", {
        type: "button", class: "btn",
        onClick: () => { editingEntryId = entry.id; rerender(); },
      }, t("common.edit")),
      confirmButton(t("roster.remove"), t("common.reallyRemove"), async () => {
        await db.removeFromRoster(entry.id);
        rerender();
      }),
    ),
  );
}

// Dieselbe Zeile im Bearbeitungsmodus
function rosterEditRow(entry, roster, rerender) {
  const numberInput = el("input", { type: "text", inputMode: "numeric", maxLength: 2, value: entry.number, class: "input-number" });
  const nameInput = el("input", { type: "text", maxLength: 60, value: entry.name });
  const error = el("p", { class: "form-error", hidden: true });

  const form = el("form", {
    class: "form-row",
    onSubmit: async (event) => {
      event.preventDefault();
      const number = parseNumber(numberInput.value);
      const name = nameInput.value.trim();
      if (number === null) return showError(error, t("error.numberFormat"));
      if (!name) return showError(error, t("error.nameRequired"));
      if (roster.some((e) => e.number === number && e.id !== entry.id)) {
        return showError(error, t("error.numberTaken"));
      }
      await db.updateRosterEntry(entry, { number, name });
      editingEntryId = null;
      rerender();
    },
  },
    numberInput,
    nameInput,
    el("button", { type: "submit", class: "btn btn-primary" }, t("common.save")),
    el("button", { type: "button", class: "btn", onClick: () => { editingEntryId = null; rerender(); } }, t("common.cancel")),
  );

  return el("li", { class: "roster-row editing" }, form, error);
}

// Formular: Spieler hinzufügen (neue Person oder bestehende Person auswählen)
function addPlayerForm(teamId, season, roster, persons, rerender) {
  // Nur Personen anbieten, die noch nicht in diesem Kader sind
  const inRoster = new Set(roster.map((e) => e.personId));
  const available = persons.filter((p) => !inRoster.has(p.id));

  const personSelect = el("select", {
    onChange: () => { nameInput.hidden = personSelect.value !== ""; },
  },
    el("option", { value: "" }, t("roster.newPerson")),
    available.map((p) => el("option", { value: p.id }, p.name)),
  );
  const numberInput = el("input", {
    type: "text", inputMode: "numeric", maxLength: 2, placeholder: t("roster.number"), class: "input-number",
  });
  const nameInput = el("input", { type: "text", maxLength: 60, placeholder: t("roster.name") });
  const error = el("p", { class: "form-error", hidden: true });

  const form = el("form", {
    class: "form-row",
    onSubmit: async (event) => {
      event.preventDefault();
      const number = parseNumber(numberInput.value);
      const personId = personSelect.value || null;
      const name = nameInput.value.trim();
      if (number === null) return showError(error, t("error.numberFormat"));
      if (!personId && !name) return showError(error, t("error.nameRequired"));
      if (roster.some((e) => e.number === number)) return showError(error, t("error.numberTaken"));
      await db.addToRoster({ teamId, season, number, personId, name });
      rerender();
    },
  },
    available.length > 0 && personSelect, // Auswahl nur zeigen, wenn es bestehende Personen gibt
    numberInput,
    nameInput,
    el("button", { type: "submit", class: "btn btn-primary" }, t("roster.addButton")),
  );

  return el("div", {}, form, error);
}
