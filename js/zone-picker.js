/*
  zone-picker.js – Zonenraster, das direkt AUF einer Feldhälfte des Spielfelds
  liegt (kein eigenes Fenster). So bleibt man beim schnellen Eingeben auf
  demselben Bild: Spieler antippen, Bewertung wählen, Zone auf dem Feld antippen.

  Benutzung (siehe match-live.js):
    zoneField({ kind, mode, rotated, onPick })  -> Element, das über die Feldhälfte gelegt wird
      kind     "target" (Ziel beim Gegner) oder "pass" (Ankunft auf der eigenen Seite)
      mode     "coarse" oder "fine" (Einstellung)
      rotated  true, wenn diese Feldhälfte auf dem Bildschirm OBEN liegt
               (dann ist das Netz unten und alles um 180° gedreht)
      onPick(zone)  zone = gespeicherter Wert (siehe zones.js), "out" = AUS

  Der Rand um das Raster (Seiten und Grundlinie, nicht das Netz) ist AUS:
  einfach daneben tippen.
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

export function zoneField({ kind, mode, rotated, onPick }) {
  let rows = buildRows(kind, mode);
  // Liegt die Hälfte oben, sieht man sie "von der anderen Seite": Reihen und Spalten umdrehen
  if (rotated) rows = rows.map((row) => [...row].reverse()).reverse();

  const size = rows.length;
  const grid = el("div", {
    class: "zone-grid",
    style: `grid-template-columns: repeat(${size}, 1fr); grid-template-rows: repeat(${size}, 1fr)`,
  }, rows.flat().map((f) => el("button", {
    type: "button", class: f.cls,
    // pointerdown statt click: reagiert sofort beim Antippen (schnelle Live-Eingabe)
    onPointerdown: (event) => { event.preventDefault(); event.stopPropagation(); onPick(f.value); },
  }, f.label)));

  // Rahmen = AUS. Tipp auf den Rahmen selbst (nicht auf ein Feld) -> AUS
  const frame = el("div", {
    class: `zone-frame${rotated ? " rotated" : ""}${kind === "pass" ? " pass" : ""}`,
    onPointerdown: (event) => {
      if (event.target === frame || event.target.classList.contains("zone-out-label")) {
        event.preventDefault();
        onPick(OUT);
      }
    },
  },
    el("span", { class: "zone-out-label" }, t("zone.out")),
    grid,
  );
  return frame;
}
