/*
  zone-picker.js – Auswahl der Zone nach der Bewertung (Aufschlag, Angriff,
  Annahme, Abwehr). Erscheint als Fenster über der Seite.

  Benutzung:
    openZonePicker({ kind, mode, rotated, title, onPick, onCancel })
      kind     "target" (Ziel beim Gegner) oder "pass" (Ankunft auf der eigenen Seite)
      mode     "coarse" oder "fine" (Einstellung)
      rotated  true, wenn diese Feldhälfte auf dem Bildschirm OBEN liegt
               (dann ist das Netz unten und alles um 180° gedreht)
      onPick(zone)  zone = gespeicherter Wert (siehe zones.js) oder null = ohne Zone
      onCancel()    Abbrechen: die Berührung wird nicht gespeichert

  Welche Werte es gibt, steht in zones.js. Hier wird nur gezeichnet.
*/
import { el } from "./dom.js";
import { t } from "./i18n.js";
import { ZONE_ROWS, OUT, BAND_NAMES, passBand } from "./zones.js";

// Hauptzonen, wie sie auf dem Feld liegen (Netz oben)
const MAIN_ROWS = [["4", "3", "2"], ["7", "8", "9"], ["5", "6", "1"]];

/*
  Baut die Felder als Liste von Reihen. Jedes Feld: { label, value, cls }.
  label = Beschriftung, value = was gespeichert wird, cls = CSS-Klassen.
*/
function buildRows(kind, mode) {
  if (kind === "target" && mode === "coarse") {
    return MAIN_ROWS.map((row) => row.map((zone) => ({ label: zone, value: zone, cls: "zone-cell zone-main" })));
  }
  return ZONE_ROWS.map((row, r) => row.map((cell, c) => {
    if (kind === "pass") {
      const band = BAND_NAMES[passBand(cell)];
      // grob: Farbzone speichern, fein: Unterzone (die Farbe ergibt sich daraus)
      return mode === "fine"
        ? { label: cell, value: cell, cls: `zone-cell band-${band}` }
        : { label: "", value: `P${passBand(cell)}`, cls: `zone-cell band-${band}` };
    }
    // Ziel fein: Hauptzonen abwechselnd hell/dunkel, damit man die 2x2-Blöcke erkennt
    const shade = (Math.floor(r / 2) + Math.floor(c / 2)) % 2 ? "shade-b" : "shade-a";
    return { label: cell, value: cell, cls: `zone-cell ${shade}` };
  }));
}

export function openZonePicker({ kind, mode, rotated, title, onPick, onCancel }) {
  let rows = buildRows(kind, mode);
  // Liegt die Hälfte oben, sieht man sie "von der anderen Seite": Reihen und Spalten umdrehen
  if (rotated) rows = rows.map((row) => [...row].reverse()).reverse();

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const pick = (zone) => { close(); onPick(zone); };
  const cancel = () => { close(); onCancel?.(); };
  const onKey = (event) => { if (event.key === "Escape") cancel(); };

  const grid = el("div", { class: "zone-grid", style: `grid-template-columns: repeat(${rows[0].length}, 1fr)` },
    rows.flat().map((f) => el("button", { type: "button", class: f.cls, onClick: () => pick(f.value) }, f.label)));

  const net = el("div", { class: "net" });
  const outButton = el("button", {
    type: "button", class: `btn zone-out${kind === "pass" ? " band-out" : ""}`, onClick: () => pick(OUT),
  }, t("zone.out"));

  const dialog = el("div", { class: "zone-dialog card stack", role: "dialog" },
    el("h3", {}, title),
    // Netz oben oder unten, so wie die Feldhälfte auf dem Bildschirm liegt
    !rotated && net,
    grid,
    rotated && net,
    outButton,
    el("p", { class: "muted small" }, t(kind === "pass" ? "zone.passHint" : "zone.targetHint")),
    el("div", { class: "row-actions" },
      el("button", { type: "button", class: "btn btn-primary", onClick: () => pick(null) }, t("zone.skip")),
      el("button", { type: "button", class: "btn", onClick: cancel }, t("common.cancel")),
    ),
  );

  // Tipp neben das Fenster = Abbrechen
  const overlay = el("div", {
    class: "zone-overlay",
    onClick: (event) => { if (event.target === overlay) cancel(); },
  }, dialog);
  document.body.appendChild(overlay);
  document.addEventListener("keydown", onKey);
}
