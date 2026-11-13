/*
  screen-settings.js – Einstellungen der App.
  Adresse: #/settings

  - Gegner erfassen: einzelne Spieler oder nur die Mannschaft
  - Zonenraster: grob (Standard) oder fein (36 Unterzonen)
  - Standard-Regelwerte für NEUE Spiele (bestehende Spiele behalten ihre Regeln)
*/
import { el, showError } from "./dom.js";
import { t } from "./i18n.js";
import { getSettings, saveSettings } from "./settings.js";
import { defaultRules } from "./rules.js";
import { rulesFields } from "./screen-match-form.js";

export function renderSettings(container) {
  const settings = getSettings();

  const modeSelect = el("select", {},
    ["players", "team"].map((value) =>
      el("option", { value, selected: settings.opponentMode === value }, t(`settings.opponentMode.${value}`))),
  );
  const zoneSelect = el("select", {},
    ["coarse", "fine"].map((value) =>
      el("option", { value, selected: settings.zoneMode === value }, t(`settings.zoneMode.${value}`))),
  );
  const rules = rulesFields(settings.rules);
  const error = el("p", { class: "form-error", hidden: true });
  const saved = el("p", { class: "form-ok", hidden: true }, t("settings.saved"));

  const form = el("form", {
    class: "stack",
    onSubmit: (event) => {
      event.preventDefault();
      saved.hidden = true;
      const result = rules.read();
      if (result.error) return showError(error, result.error);
      showError(error, null);
      saveSettings({ opponentMode: modeSelect.value, zoneMode: zoneSelect.value, rules: result.rules });
      saved.hidden = false;
    },
  },
    el("label", { class: "field" }, el("span", {}, t("settings.opponentMode")), modeSelect),
    el("p", { class: "muted small" }, t("settings.opponentModeHint")),
    el("label", { class: "field" }, el("span", {}, t("settings.zoneMode")), zoneSelect),
    el("p", { class: "muted small" }, t("settings.zoneModeHint")),
    el("h3", {}, t("settings.defaultRules")),
    el("p", { class: "muted small" }, t("settings.defaultRulesHint")),
    rules.element,
    error,
    saved,
    el("div", { class: "row-actions" },
      el("button", { type: "submit", class: "btn btn-primary" }, t("common.save")),
      el("button", {
        type: "button", class: "btn",
        onClick: () => {
          saveSettings({ opponentMode: modeSelect.value, zoneMode: zoneSelect.value, rules: defaultRules() });
          renderSettings(container);
        },
      }, t("settings.resetRules")),
    ),
  );

  container.replaceChildren(
    el("a", { class: "back-link", href: "#/" }, `← ${t("nav.teams")}`),
    el("section", { class: "card" }, el("h2", {}, t("nav.settings")), form),
  );
}
