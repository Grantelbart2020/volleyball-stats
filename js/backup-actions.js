/*
  backup-actions.js – Sicherung speichern, Spiel exportieren, Sicherung einlesen.
  Verbindet backup.js (Logik) mit db.js (Daten) und dem Bildschirm.
  Benutzt von screen-settings.js (Sicherung, Import) und screen-match.js
  (Spiel exportieren, Hinweis nach Spielende).
*/
import { el, showError } from "./dom.js";
import { t, tf } from "./i18n.js";
import * as db from "./db.js";
import { STORES, buildBackup, matchSubset, parseBackup, planImport, planIsEmpty } from "./backup.js";
import { readSetting, saveSetting } from "./settings.js";

const STORAGE_KEY_LAST_BACKUP = "vbstats.lastBackup";

// Zeitpunkt der letzten Gesamtsicherung auf diesem Gerät (ISO-Text) oder null
export function lastBackupAt() {
  return readSetting(STORAGE_KEY_LAST_BACKUP);
}

/*
  Bietet eine Datei zum Herunterladen an. Der Browser speichert sie im
  Download-Ordner (am Handy: "Downloads"). Ein "Blob" ist ein Datei-Inhalt im
  Speicher; die Adresse dafür (createObjectURL) gilt nur kurz.
*/
function downloadJson(fileName, object) {
  const blob = new Blob([JSON.stringify(object, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: fileName });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10); // "2026-11-13"

// Nur Buchstaben, Ziffern und Bindestrich im Dateinamen
const safe = (text) => String(text).normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// Ganze Sicherung speichern und den Zeitpunkt merken
export async function downloadFullBackup() {
  const data = await db.exportAll();
  downloadJson(`vbstats-sicherung-${today()}.json`, buildBackup(data, "full"));
  saveSetting(STORAGE_KEY_LAST_BACKUP, new Date().toISOString());
}

// Ein einzelnes Spiel exportieren (mit Teams, Kadern und Personen)
export async function downloadMatch(match) {
  const subset = matchSubset(await db.exportAll(), match.id);
  downloadJson(`vbstats-spiel-${match.date.slice(0, 10)}-${safe(match.opponent) || "spiel"}.json`, buildBackup(subset, "match"));
}

/* ---------- Sicherung einlesen ---------- */

/*
  Baut den Bereich "Sicherung einlesen": Datei wählen -> Vorschau (was kommt
  dazu, was wird übersprungen) -> "Übernehmen". Erst dann wird gespeichert.
*/
export function importSection() {
  const error = el("p", { class: "form-error", hidden: true });
  const result = el("div", { class: "stack" });
  const fileInput = el("input", {
    type: "file", accept: ".json,application/json",
    onChange: async () => {
      showError(error, null);
      result.replaceChildren();
      const file = fileInput.files[0];
      if (!file) return;
      const parsed = parseBackup(await file.text());
      if (parsed.error) return showError(error, t(`error.${parsed.error}`));
      const plan = planImport(await db.exportAll(), parsed.backup.data);
      result.replaceChildren(preview(parsed.backup, plan, () => { fileInput.value = ""; result.replaceChildren(); }));
    },
  });
  return el("div", { class: "stack" },
    el("label", { class: "field" }, el("span", {}, t("backup.chooseFile")), fileInput),
    error,
    result,
  );
}

// Vorschau des Imports mit Zahlen pro Bereich und Knopf zum Übernehmen
function preview(backup, plan, reset) {
  const rows = STORES.map((store) => {
    const s = plan.stats[store];
    return el("tr", {},
      el("td", {}, t(`backup.store.${store}`)),
      el("td", {}, s.added), el("td", {}, s.updated), el("td", {}, s.unchanged), el("td", {}, s.skipped));
  });
  const conflictText = plan.conflicts.some((c) => c.type === "matchEvents") && t("backup.conflictEvents");
  const numberText = plan.conflicts.some((c) => c.type === "number") && t("backup.conflictNumbers");
  const done = el("p", { class: "form-ok", hidden: true }, t("backup.imported"));

  const apply = el("button", {
    type: "button", class: "btn btn-primary", disabled: planIsEmpty(plan),
    onClick: async () => {
      apply.disabled = true;
      await db.importData(plan.put);
      done.hidden = false;
    },
  }, t("backup.apply"));

  return el("div", { class: "panel stack" },
    el("p", {}, tf(backup.kind === "match" ? "backup.previewMatch" : "backup.previewFull",
      { date: new Date(backup.exportedAt).toLocaleString() })),
    el("table", { class: "backup-table" },
      el("thead", {}, el("tr", {},
        el("th", {}, ""), el("th", {}, t("backup.added")), el("th", {}, t("backup.updated")),
        el("th", {}, t("backup.unchanged")), el("th", {}, t("backup.skipped")))),
      el("tbody", {}, rows)),
    conflictText && el("p", { class: "form-warning" }, conflictText),
    numberText && el("p", { class: "form-warning" }, numberText),
    planIsEmpty(plan) && el("p", { class: "muted" }, t("backup.nothingNew")),
    done,
    el("div", { class: "row-actions" },
      apply,
      el("button", { type: "button", class: "btn", onClick: reset }, t("common.cancel")),
    ),
  );
}
