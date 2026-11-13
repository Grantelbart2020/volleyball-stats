/*
  screen-match-form.js – Spiel anlegen oder Spielangaben ändern.
  Adressen: #/team/<teamId>/match/new  und  #/match/<id>/edit

  Enthält auch rulesFields(...): die Eingabefelder für die Regelwerte.
  Die Einstellungen (screen-settings.js) benutzen sie ebenfalls.
*/
import { el, showError } from "./dom.js";
import { t } from "./i18n.js";
import * as db from "./db.js";
import { RULE_LIMITS, defaultRules, seasonForDate } from "./rules.js";
import { getSettings } from "./settings.js";

/* ---------- Regelwerte als Eingabefelder ---------- */

// Reihenfolge der Felder; der Text steht in den Sprachdateien unter "rules.<name>".
const RULE_FIELDS = [
  "setsToWin", "pointsPerSet", "pointsDecidingSet", "minLead",
  "maxSubstitutions", "maxTimeouts", "maxPlayers", "maxLiberos",
];

/*
  Baut die Felder für alle Regelwerte.
  Gibt { element, read } zurück: read() liefert { rules } oder { error }.
*/
export function rulesFields(rules, disabled = false) {
  const inputs = {};
  const rows = RULE_FIELDS.map((name) => {
    inputs[name] = el("input", {
      // ältere Spiele kennen neue Regelwerte (z. B. Auszeiten) noch nicht -> Standardwert
      type: "text", inputMode: "numeric", maxLength: 2, value: rules[name] ?? defaultRules()[name],
      class: "input-number", disabled,
    });
    const [min, max] = RULE_LIMITS[name];
    return el("label", { class: "rule-row" },
      el("span", {}, t(`rules.${name}`), el("small", { class: "muted" }, ` (${min}–${max})`)),
      inputs[name],
    );
  });

  function read() {
    const result = {};
    for (const name of RULE_FIELDS) {
      const text = inputs[name].value.trim();
      const [min, max] = RULE_LIMITS[name];
      const value = Number(text);
      if (!/^\d+$/.test(text) || value < min || value > max) {
        return { error: `${t(`rules.${name}`)}: ${t("error.ruleRange")} ${min}–${max}` };
      }
      result[name] = value;
    }
    return { rules: result };
  }

  return { element: el("div", { class: "rule-grid" }, rows), read };
}

/* ---------- Datum ---------- */

// Datum als Text für <input type="datetime-local">, z. B. "2026-11-12T19:30" (Ortszeit).
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ---------- Bildschirm ---------- */

export async function renderMatchForm(container, { teamId, matchId }) {
  const match = matchId ? await db.getMatch(matchId) : null;
  const team = await db.getTeam(match?.teamId ?? teamId);
  if (!team || (matchId && !match)) {
    container.replaceChildren(
      el("a", { class: "back-link", href: "#/" }, `← ${t("nav.teams")}`),
      el("section", { class: "card" }, el("p", {}, t("match.notFound"))),
    );
    return;
  }

  // Regeln lassen sich nur ändern, solange das Spiel noch nicht begonnen hat.
  const started = match ? (await db.listMatchEvents(match.id)).length > 0 : false;
  const backHref = match ? `#/match/${match.id}` : `#/team/${team.id}`;

  const opponentInput = el("input", {
    type: "text", maxLength: 60, value: match?.opponent ?? "", placeholder: t("match.opponentPlaceholder"),
  });
  const dateInput = el("input", { type: "datetime-local", value: match?.date ?? toLocalInputValue(new Date()) });
  const homeAwaySelect = el("select", {},
    ["", "home", "away"].map((value) =>
      el("option", { value, selected: (match?.homeAway ?? "") === value }, t(`match.homeAway.${value || "none"}`))),
  );
  const competitionInput = el("input", {
    type: "text", maxLength: 60, value: match?.competition ?? "", placeholder: t("match.competitionPlaceholder"),
  });
  const noteInput = el("textarea", { maxLength: 500, rows: 3, value: match?.note ?? "" });
  const rules = rulesFields(match?.rules ?? getSettings().rules, started);
  const error = el("p", { class: "form-error", hidden: true });

  const form = el("form", {
    class: "stack",
    onSubmit: async (event) => {
      event.preventDefault();
      const opponent = opponentInput.value.trim();
      const date = dateInput.value;
      if (!opponent) return showError(error, t("error.opponentRequired"));
      if (!date || Number.isNaN(new Date(date).getTime())) return showError(error, t("error.dateRequired"));
      const ruleResult = rules.read();
      if (ruleResult.error) return showError(error, ruleResult.error);

      const saved = await db.saveMatch({
        id: match?.id,
        teamId: team.id,
        season: seasonForDate(new Date(date)),
        date,
        opponent,
        homeAway: homeAwaySelect.value || null,
        competition: competitionInput.value.trim(),
        note: noteInput.value.trim(),
        rules: started ? match.rules : ruleResult.rules,
      });
      location.hash = `#/match/${saved.id}`;
    },
  },
    el("label", { class: "field" }, el("span", {}, t("match.opponent")), opponentInput),
    el("label", { class: "field" }, el("span", {}, t("match.date")), dateInput),
    el("p", { class: "muted small" }, t("match.seasonHint")),
    el("label", { class: "field" }, el("span", {}, t("match.homeAway")), homeAwaySelect),
    el("label", { class: "field" }, el("span", {}, t("match.competition")), competitionInput),
    el("label", { class: "field" }, el("span", {}, t("match.note")), noteInput),
    el("details", { class: "rules-details" },
      el("summary", {}, t("rules.title")),
      started && el("p", { class: "muted small" }, t("rules.lockedHint")),
      rules.element,
    ),
    error,
    el("div", { class: "row-actions" },
      el("button", { type: "submit", class: "btn btn-primary" }, t("common.save")),
      el("a", { class: "btn", href: backHref }, t("common.cancel")),
    ),
  );

  container.replaceChildren(
    el("a", { class: "back-link", href: backHref }, `← ${match ? match.opponent : team.name}`),
    el("section", { class: "card" },
      el("h2", {}, match ? t("match.edit") : `${t("match.new")} – ${team.name}`),
      form,
    ),
  );
}
