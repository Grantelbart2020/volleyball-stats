/*
  screen-teams.js – Startbildschirm: Liste der Teams, neues Team anlegen.
  Adresse: #/
*/
import { el, showError } from "./dom.js";
import { t } from "./i18n.js";
import * as db from "./db.js";

export async function renderTeams(container) {
  const teams = await db.listTeams();

  // Liste der Teams (oder Hinweis, wenn noch keins existiert)
  const list = teams.length
    ? el("ul", { class: "list" },
        teams.map((team) =>
          el("li", {}, el("a", { class: "list-link", href: `#/team/${team.id}` }, team.name))
        ))
    : el("p", { class: "muted" }, t("teams.empty"));

  // Formular: neues Team
  const nameInput = el("input", {
    type: "text", maxLength: 60, required: true, placeholder: t("teams.namePlaceholder"),
  });
  const error = el("p", { class: "form-error", hidden: true });

  const form = el("form", {
    class: "form-row",
    onSubmit: async (event) => {
      event.preventDefault(); // verhindert, dass der Browser die Seite neu lädt
      const name = nameInput.value.trim();
      if (!name) return showError(error, t("error.nameRequired"));
      const team = await db.saveTeam({ name });
      location.hash = `#/team/${team.id}`; // direkt zum neuen Team
    },
  },
    nameInput,
    el("button", { type: "submit", class: "btn btn-primary" }, t("teams.create")),
  );

  container.replaceChildren(
    el("section", { class: "card" },
      el("h2", {}, t("teams.title")),
      list,
      el("h3", {}, t("teams.new")),
      form,
      error,
    ),
    el("section", { class: "card" },
      el("h2", {}, t("test.title")),
      el("p", { class: "muted" }, t("home.testHint")),
      el("a", { class: "btn", href: "#/test" }, t("home.openTest")),
    ),
  );
}
