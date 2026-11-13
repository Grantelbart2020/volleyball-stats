/*
  screen-match.js – ein Spiel.
  Adresse: #/match/<id>

  Aufbau von oben nach unten:
  1. Kopf: Gegner, Datum, Ergebnis, Bearbeiten, Löschen
  2. Läuft ein Satz: Spielfeld mit Spielstand (match-live.js)
     Sonst: nächsten Satz starten (Aufschlag, Aufstellung, Libero-Partner)
  3. Rückgängig (letztes Ereignis löschen)
  4. Spielkader (aus dem Saison-Kader) und Gegnerkader
  5. Verlauf (alle Ereignisse)

  Der Stand des Spiels wird bei jedem Zeichnen mit computeMatch() aus den
  gespeicherten Ereignissen berechnet (siehe rules.js).
*/
import { el, confirmButton, showError } from "./dom.js";
import { t, tf } from "./i18n.js";
import * as db from "./db.js";
import {
  OWN, OPP, applyEvent, checkOwnRoster, computeMatch, eventError, setStartError, suggestedFirstServe,
} from "./rules.js";
import { getSettings } from "./settings.js";
import { eventText, formatDate, matchResultText, playerLabel } from "./match-format.js";
import { liveCard } from "./match-live.js";
import { downloadFullBackup, downloadMatch, lastBackupAt } from "./backup-actions.js";

/*
  Warteschlange zum Speichern: Ereignisse werden streng nacheinander gespeichert.
  Tippt jemand doppelt, wartet der zweite Tipp, bis der erste fertig ist, und
  wird dann gegen den neuen Stand geprüft (siehe saveEvent).
*/
let saveQueue = Promise.resolve();

// Fehlercode der zuletzt abgelehnten Eingabe; wird beim nächsten Zeichnen einmal angezeigt.
let lastProblem = null;

/*
  Speichert ein Ereignis, wenn es zum FRISCH aus der Datenbank berechneten Stand
  passt. Hängt den Spielstand nach dem Ereignis an (für Verlauf und Auswertung).
  Gibt einen Fehlercode zurück oder null.
*/
async function saveEvent(match, players, event) {
  const state = computeMatch(match.rules, players, await db.listMatchEvents(match.id));
  const problem = eventError(state, event, players, match.rules);
  if (problem) return problem;
  const data = { ...event };
  if (data.type !== "setStart") {
    data.setNumber = state.activeSet.number;
    data.score = { ...applyEvent(state.activeSet, data).score };
  }
  if (data.type === "touch") {
    // Laufende Nummern für die Auswertung: Ballwechsel im Satz, Berührung im Ballwechsel
    data.rally = state.activeSet.rallies + 1;
    data.touchNo = state.activeSet.rally.length + 1;
  }
  await db.addMatchEvent(match.id, data);
  return null;
}

export async function renderMatch(container, matchId) {
  const match = await db.getMatch(matchId);
  if (!match) {
    container.replaceChildren(
      el("a", { class: "back-link", href: "#/" }, `← ${t("nav.teams")}`),
      el("section", { class: "card" }, el("p", {}, t("match.notFound"))),
    );
    return;
  }
  const [team, players, events, roster] = await Promise.all([
    db.getTeam(match.teamId),
    db.listMatchPlayers(match.id),
    db.listMatchEvents(match.id),
    db.listRoster(match.teamId, match.season),
  ]);
  const state = computeMatch(match.rules, players, events);
  const problem = lastProblem;
  lastProblem = null; // nur einmal anzeigen

  // ctx ("context") bündelt alles, was die einzelnen Karten brauchen.
  const ctx = {
    match, team, players, events, roster, state,
    problem,
    settings: getSettings(),
    playerById: new Map(players.map((p) => [p.id, p])),
    names: { own: team?.name ?? "?", opp: match.opponent },
    rerender: () => renderMatch(container, matchId),
    // Speichert ein Ereignis (über die Warteschlange) und zeichnet neu.
    addEvent(event) {
      const job = saveQueue.then(() => saveEvent(match, players, event));
      saveQueue = job.catch(() => {}); // ein Fehler soll die Schlange nicht blockieren
      return job.then((problem) => {
        if (problem) console.warn("Ereignis nicht gespeichert:", problem, event);
        lastProblem = problem;
        return ctx.rerender();
      });
    },
  };

  container.replaceChildren(...[
    el("a", { class: "back-link", href: `#/team/${match.teamId}` }, `← ${ctx.names.own}`),
    headerCard(ctx),
    backupReminder(ctx),
    state.activeSet && liveCard(ctx),
    state.nextSetNumber && setStartCard(ctx),
    events.length > 0 && undoCard(ctx),
    ownRosterCard(ctx),
    oppRosterCard(ctx),
    events.length > 0 && historyCard(ctx),
  ].filter(Boolean));
}

/* ---------- Hilfen ---------- */

// Alle Spieler, die in Ereignissen vorkommen. Diese dürfen nicht mehr aus dem Kader.
function usedPlayerIds(events) {
  const ids = new Set();
  for (const e of events) {
    for (const id of [...(e.lineup?.own ?? []), ...(e.lineup?.opp ?? []), e.outId, e.inId, e.playerId]) {
      if (id) ids.add(id);
    }
  }
  return ids;
}

function side(ctx, team) {
  return ctx.players.filter((p) => p.side === team);
}

/* ---------- 1. Kopf ---------- */

function headerCard(ctx) {
  const { match, state } = ctx;
  const details = [
    formatDate(match.date),
    match.homeAway && t(`match.homeAway.${match.homeAway}`),
    match.competition,
  ].filter(Boolean).join(" · ");

  let status = t("match.status.notStarted");
  if (state.matchOver) {
    status = state.setsWon.own > state.setsWon.opp ? t("match.status.won") : t("match.status.lost");
  } else if (state.sets.length) {
    status = t("match.status.running");
  }

  return el("section", { class: "card" },
    el("h2", {}, `${ctx.names.own} – ${match.opponent}`),
    el("p", { class: "muted" }, details),
    el("p", { class: "match-summary" }, el("strong", {}, matchResultText(state)), ` · ${status}`),
    match.note && el("p", { class: "muted small" }, match.note),
    el("div", { class: "row-actions" },
      el("a", { class: "btn", href: `#/match/${match.id}/edit` }, t("common.edit")),
      state.sets.length > 0 && el("a", { class: "btn", href: `#/match/${match.id}/report` }, t("match.report")),
      el("button", { type: "button", class: "btn", onClick: () => downloadMatch(match) }, t("backup.exportMatch")),
      confirmButton(t("match.delete"), t("common.reallyDelete"), async () => {
        await db.deleteMatch(match.id);
        location.hash = `#/team/${match.teamId}`;
      }),
    ),
  );
}

/*
  Nach Spielende: Sicherung anbieten, wenn die letzte Sicherung älter ist als
  das letzte Ereignis dieses Spiels (lokale Browserdaten können verloren gehen).
*/
function backupReminder(ctx) {
  if (!ctx.state.matchOver) return null;
  const lastEvent = ctx.events[ctx.events.length - 1];
  const last = lastBackupAt();
  if (last && lastEvent && last > lastEvent.createdAt) return null;
  const card = el("section", { class: "card suggestion" },
    el("p", {}, t("backup.reminder")),
    el("div", { class: "row-actions" },
      el("button", {
        type: "button", class: "btn btn-primary",
        onClick: async () => { await downloadFullBackup(); card.remove(); },
      }, t("backup.save")),
    ),
  );
  return card;
}

/* ---------- 2. Satz starten ---------- */

/*
  Felder für eine Aufstellung, angeordnet wie auf dem Feld:
    vorne:  Pos. 4 | Pos. 3 | Pos. 2
    hinten: Pos. 5 | Pos. 6 | Pos. 1
  Gibt { element, read } zurück; read() liefert die 6 ids (Index 0 = Pos. 1).
*/
function lineupPicker(players, preset, labelKey) {
  const selects = [0, 1, 2, 3, 4, 5].map((index) =>
    el("select", {},
      el("option", { value: "" }, "–"),
      players.map((p) => el("option", { value: p.id, selected: preset?.[index] === p.id }, playerLabel(p))),
    ));
  const cell = (index) => el("label", { class: "field" },
    el("span", { class: "small" }, tf(labelKey, { n: index + 1 })), selects[index]);
  return {
    element: el("div", { class: "lineup-grid" }, [3, 2, 1, 4, 5, 0].map(cell)),
    read: () => selects.map((s) => s.value),
  };
}

function setStartCard(ctx) {
  const { state, match, players } = ctx;
  const number = state.nextSetNumber;
  const previous = [...ctx.events].reverse().find((e) => e.type === "setStart"); // zum Vorbelegen
  const ownRegular = side(ctx, OWN).filter((p) => !p.isLibero);
  const oppRegular = side(ctx, OPP).filter((p) => !p.isLibero);
  const ownLiberos = side(ctx, OWN).filter((p) => p.isLibero);
  const error = el("p", { class: "form-error", hidden: true });

  // Erster Aufschlag: in Satz 1 und im Entscheidungssatz ausgelost, sonst vorbelegt
  const suggestion = suggestedFirstServe(number, state.sets, match.rules);
  const serveSelect = el("select", {},
    el("option", { value: "" }, t("set.chooseServe")),
    [OWN, OPP].map((team) => el("option", { value: team, selected: suggestion === team }, ctx.names[team])),
  );

  const ownLineup = lineupPicker(ownRegular, previous?.lineup.own, "set.position");

  // Libero-Partner: für wen der Libero normalerweise kommt
  const partnerBoxes = ownRegular.map((p) => ({
    id: p.id,
    box: el("input", { type: "checkbox", checked: previous?.liberoPartners?.own?.includes(p.id) ?? false }),
    label: playerLabel(p),
  }));

  // Gegner-Aufstellung: optional und nur, wenn Gegnerspieler einzeln erfasst werden
  const withOppLineup = ctx.settings.opponentMode === "players";
  const oppLineup = lineupPicker(oppRegular, previous?.lineup.opp, "set.oppPosition");
  const oppToggle = el("input", {
    type: "checkbox", checked: Boolean(previous?.lineup.opp),
    onChange: () => { oppLineup.element.hidden = !oppToggle.checked; },
  });
  oppLineup.element.hidden = !oppToggle.checked;

  const startButton = el("button", {
    type: "button", class: "btn btn-primary",
    onClick: async () => {
      const ownIds = ownLineup.read();
      const event = {
        type: "setStart",
        setNumber: number,
        firstServe: serveSelect.value || null,
        lineup: { own: ownIds, opp: withOppLineup && oppToggle.checked ? oppLineup.read() : null },
        liberoPartners: {
          own: partnerBoxes.filter((b) => b.box.checked).map((b) => b.id),
          opp: [],
        },
      };
      const problem = setStartError(state, event, players);
      if (problem) return showError(error, t(`error.${problem}`));
      await ctx.addEvent(event);
    },
  }, tf("set.start", { n: number }));

  // Hinweis, wenn noch Spieler fehlen
  const missing = [];
  if (ownRegular.length < 6) missing.push(t("set.needOwnPlayers"));
  if (side(ctx, OPP).length < 6) missing.push(t("set.needOppPlayers"));

  return el("section", { class: "card stack" },
    el("h3", {}, tf("set.start", { n: number })),
    missing.map((text) => el("p", { class: "form-warning" }, text)),
    el("label", { class: "field" }, el("span", {}, t("set.firstServe")), serveSelect),
    suggestion === null && el("p", { class: "muted small" }, t("set.tossHint")),
    el("h3", {}, tf("set.lineupOf", { team: ctx.names.own })),
    ownLineup.element,
    ownLiberos.length > 0 && el("div", {},
      el("h3", {}, t("set.liberoPartners")),
      el("p", { class: "muted small" }, t("set.liberoPartnersHint")),
      el("div", { class: "chip-list" }, partnerBoxes.map((b) =>
        el("label", { class: "chip" }, b.box, ` ${b.label}`))),
    ),
    withOppLineup && el("div", {},
      el("label", { class: "checkbox" }, oppToggle, ` ${tf("set.withOppLineup", { team: ctx.names.opp })}`),
      oppLineup.element,
    ),
    error,
    startButton,
  );
}

/* ---------- 3. Rückgängig ---------- */

function undoCard(ctx) {
  const last = ctx.events[ctx.events.length - 1];
  return el("section", { class: "card undo-card" },
    el("span", { class: "muted small" }, `${t("undo.last")}: ${eventText(last, ctx.names, ctx.playerById)}`),
    el("button", {
      type: "button", class: "btn",
      onClick: async () => {
        await db.deleteLastMatchEvent(ctx.match.id);
        ctx.rerender();
      },
    }, `↶ ${t("undo.button")}`),
  );
}

/* ---------- 4a. Eigener Spielkader ---------- */

function ownRosterCard(ctx) {
  const { match } = ctx;
  const own = side(ctx, OWN);
  const used = usedPlayerIds(ctx.events);
  const started = ctx.events.length > 0;
  const error = el("p", { class: "form-error", hidden: true });
  const check = checkOwnRoster(own, match.rules);

  // Zeilen: alle aus dem Saison-Kader, dazu Spieler, die nicht (mehr) im Saison-Kader sind
  const byPerson = new Map(own.map((p) => [p.personId, p]));
  const rosterPersons = new Set(ctx.roster.map((e) => e.personId));
  const rows = [
    ...ctx.roster.map((entry) => ({ entry, player: byPerson.get(entry.personId) })),
    ...own.filter((p) => !rosterPersons.has(p.personId)).map((p) => ({ entry: p, player: p })),
  ];

  const rowFor = ({ entry, player }) => {
    const inMatch = el("input", {
      type: "checkbox", checked: Boolean(player),
      onChange: async () => {
        if (player) {
          if (used.has(player.id)) {
            inMatch.checked = true;
            return showError(error, t("error.playerUsed"));
          }
          await db.removeMatchPlayer(player.id);
        } else {
          const problems = checkOwnRoster([...own, { isLibero: false }], match.rules).errors;
          if (problems.length) {
            inMatch.checked = false;
            return showError(error, t(`error.${problems[0]}`));
          }
          await db.addMatchPlayer({ matchId: match.id, side: OWN, personId: entry.personId, number: entry.number });
        }
        ctx.rerender();
      },
    });

    const liberoBox = player && el("input", {
      type: "checkbox", checked: player.isLibero, disabled: started,
      onChange: async () => {
        const next = own.map((p) => (p.id === player.id ? { ...p, isLibero: !p.isLibero } : p));
        const problems = checkOwnRoster(next, match.rules).errors;
        if (problems.length) {
          liberoBox.checked = player.isLibero;
          return showError(error, t(`error.${problems[0]}`));
        }
        await db.updateMatchPlayer(player.id, { isLibero: !player.isLibero });
        ctx.rerender();
      },
    });

    return el("li", { class: "roster-row" },
      el("label", { class: "checkbox-inline grow" },
        inMatch,
        el("span", { class: "roster-number" }, entry.number),
        el("span", { class: "roster-name" }, entry.name),
      ),
      liberoBox && el("label", { class: "checkbox-inline" }, liberoBox, t("player.libero")),
    );
  };

  const liberoCount = own.filter((p) => p.isLibero).length;
  return el("section", { class: "card" },
    el("h3", {}, tf("matchRoster.title", {
      team: ctx.names.own, count: own.length, max: match.rules.maxPlayers, liberos: liberoCount,
    })),
    rows.length
      ? el("ul", { class: "roster" }, rows.map(rowFor))
      : el("p", { class: "muted" }, tf("matchRoster.emptySeason", { season: match.season }),
          " ", el("a", { href: `#/team/${match.teamId}` }, t("matchRoster.toTeam"))),
    started && el("p", { class: "muted small" }, t("matchRoster.liberoLocked")),
    check.warnings.map((w) => el("p", { class: "form-warning" }, t(`warning.${w}`))),
    error,
  );
}

/* ---------- 4b. Gegnerkader ---------- */

function parseNumber(text) {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  return Number(text);
}

function oppRosterCard(ctx) {
  const { match } = ctx;
  const opp = side(ctx, OPP);
  const used = usedPlayerIds(ctx.events);
  const started = ctx.events.length > 0;
  const error = el("p", { class: "form-error", hidden: true });

  const rows = opp.map((player) => {
    const liberoBox = el("input", {
      type: "checkbox", checked: player.isLibero, disabled: started,
      onChange: async () => {
        await db.updateMatchPlayer(player.id, { isLibero: !player.isLibero });
        ctx.rerender();
      },
    });
    return el("li", { class: "roster-row" },
      el("span", { class: "roster-number" }, player.number),
      el("span", { class: "roster-name" }, player.name || "–"),
      el("label", { class: "checkbox-inline" }, liberoBox, t("player.libero")),
      !used.has(player.id) && el("span", { class: "row-actions" },
        confirmButton(t("roster.remove"), t("common.reallyRemove"), async () => {
          await db.removeMatchPlayer(player.id);
          ctx.rerender();
        })),
    );
  });

  // Formular: Gegnerspieler hinzufügen (auch mitten im Spiel möglich)
  const numberInput = el("input", {
    type: "text", inputMode: "numeric", maxLength: 2, placeholder: t("roster.number"), class: "input-number",
  });
  const nameInput = el("input", { type: "text", maxLength: 60, placeholder: t("oppRoster.nameOptional") });
  const liberoInput = el("input", { type: "checkbox", disabled: started });
  const form = el("form", {
    class: "form-row",
    onSubmit: async (event) => {
      event.preventDefault();
      const number = parseNumber(numberInput.value);
      if (number === null) return showError(error, t("error.numberFormat"));
      if (opp.some((p) => p.number === number)) return showError(error, t("error.numberTakenMatch"));
      // Bei verknüpftem Gegnerteam landet der Spieler auch in dessen Saison-Kader (db.js)
      await db.addOpponentPlayer(match, { number, name: nameInput.value.trim(), isLibero: liberoInput.checked });
      ctx.rerender();
    },
  },
    numberInput,
    nameInput,
    el("label", { class: "checkbox-inline" }, liberoInput, t("player.libero")),
    el("button", { type: "submit", class: "btn btn-primary" }, t("roster.addButton")),
  );

  // Gegner ist ein angelegtes Team: Hinweis und Knopf, um fehlende Spieler aus dem Saison-Kader zu holen
  const linked = match.opponentTeamId && el("div", { class: "row-actions" },
    el("span", { class: "muted small grow" }, tf("oppRoster.linked", { team: match.opponent, season: match.season })),
    el("button", {
      type: "button", class: "btn",
      onClick: async () => {
        const added = await db.copyOpponentRoster(match);
        if (!added) return showError(error, t("oppRoster.nothingToCopy"));
        ctx.rerender();
      },
    }, t("oppRoster.copyMissing")),
  );

  return el("section", { class: "card" },
    el("h3", {}, tf("oppRoster.title", { team: match.opponent, count: opp.length })),
    linked,
    opp.length ? el("ul", { class: "roster" }, rows) : el("p", { class: "muted" }, t("oppRoster.empty")),
    opp.length < 6 && el("p", { class: "form-warning" }, t("set.needOppPlayers")),
    el("h3", {}, t("oppRoster.add")),
    form,
    error,
  );
}

/* ---------- 5. Verlauf ---------- */

function historyCard(ctx) {
  const items = [...ctx.events].reverse().map((event) =>
    el("li", {},
      event.score && el("span", { class: "history-score" }, `${event.score.own}:${event.score.opp}`),
      eventText(event, ctx.names, ctx.playerById),
    ));
  return el("section", { class: "card" },
    el("details", {},
      el("summary", {}, tf("history.title", { count: ctx.events.length })),
      el("ul", { class: "history" }, items),
    ),
  );
}
