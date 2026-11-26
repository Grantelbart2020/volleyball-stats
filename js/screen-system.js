/*
  screen-system.js – ein Laufweg-System eines Teams bearbeiten.
  Adresse: #/team/<id>/system/<systemId>

  Rotation für Rotation (◀ ▶): oben die offizielle Aufstellung (nur zum
  Orientieren), darunter Annahme und Spielposition. Spieler ziehen und auf
  einen anderen ablegen = Plätze tauschen (drag-swap.js). Jede Änderung wird
  sofort am Team gespeichert (team.systems).
*/
import { el } from "./dom.js";
import { t, tf } from "./i18n.js";
import * as db from "./db.js";
import { ANCHOR_POS, buildSystem, rotationCount, systemLabels, teamSystems } from "./formation.js";
import { dragSwap } from "./drag-swap.js";

// Zuletzt angezeigte Rotation pro System (solange die App offen ist)
const rotationBySystem = new Map();

// Felder wie auf dem Spielfeld, Netz oben: vorne 4 3 2, hinten 5 6 1
const GRID = [4, 3, 2, 5, 6, 1];

export async function renderSystem(container, teamId, systemId) {
  const rerender = () => renderSystem(container, teamId, systemId);
  const backLink = el("a", { class: "back-link", href: `#/team/${teamId}` }, "← ");
  const team = await db.getTeam(teamId);
  // Ohne gespeicherte Systeme hat das Team das eingebaute 5-1; Änderungen speichern es als eigenes
  const systems = teamSystems(team);
  const system = team && systems.find((s) => s.id === systemId);
  if (!system) {
    container.replaceChildren(backLink, el("section", { class: "card" }, el("p", {}, t("system.notFound"))));
    return;
  }
  backLink.append(team.name);
  const save = () => db.updateTeam(teamId, { systems });

  const count = rotationCount(system.pattern);
  const r = Math.min(rotationBySystem.get(systemId) ?? 1, count);
  const goTo = (next) => { rotationBySystem.set(systemId, next); rerender(); };
  // Fehlt eine Tabelle oder ist sie kaputt (z. B. aus einer Importdatei): Standard einsetzen
  const fresh = buildSystem(system.id, system.name, system.pattern);
  for (const kind of ["receive", "play"]) {
    const table = system[kind]?.[r];
    const ok = Array.isArray(table) && table.length === 6 && new Set(table).size === 6;
    if (!ok) system[kind] = { ...system[kind], [r]: fresh[kind][r] };
  }
  const s = ANCHOR_POS[r - 1] - 1;
  const labels = systemLabels(system.pattern, r, (role) => t(`roleShort.${role}`));
  // Offizielle Aufstellung als Tabelle: auf Feld f steht offiziell Abstand (f - 1 - s)
  const official = [0, 1, 2, 3, 4, 5].map((i) => (i - s + 6) % 6);

  const nameInput = el("input", {
    type: "text", maxLength: 40, value: system.name,
    onChange: async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.value = system.name; return; }
      system.name = name;
      await save();
    },
  });

  // Ein Raster mit 6 Feldern; editable = Ziehen zum Tauschen (table wird dabei geändert)
  const grid = (title, table, editable) => {
    const cells = GRID.map((field) => {
      const k = table[field - 1];
      const cell = el("div", { class: `court-spot system-spot${editable ? " draggable" : ""}` },
        // klein in der Ecke: offizielle Position dieser Person
        el("span", { class: "spot-pos" }, ((s + k) % 6) + 1),
        el("span", { class: "spot-number" }, labels[k]),
      );
      cell.dataset.field = field;
      return cell;
    });
    if (editable) {
      for (const cell of cells) {
        cell.addEventListener("pointerdown", (event) => dragSwap(event, {
          source: cell, targets: cells,
          onDrop: async (target) => {
            const a = Number(cell.dataset.field) - 1;
            const b = Number(target.dataset.field) - 1;
            [table[a], table[b]] = [table[b], table[a]];
            await save();
            rerender();
          },
        }));
      }
    }
    return el("div", { class: "stack" },
      el("h3", {}, title),
      el("div", { class: "system-net" }, t("system.net")),
      el("div", { class: "lineup-court system-court" }, cells),
    );
  };

  const resetRotation = async () => {
    system.receive[r] = fresh.receive[r];
    system.play[r] = fresh.play[r];
    await save();
    rerender();
  };

  container.replaceChildren(
    backLink,
    el("section", { class: "card stack" },
      el("h2", {}, t("system.editTitle")),
      el("label", { class: "field" }, el("span", {}, t("system.name")), nameInput),
      el("p", { class: "muted small" }, system.pattern.map((role) => t(`roleShort.${role}`)).join(" ")),
      el("p", { class: "muted small" }, t("system.dragHint")),
      count === 3 && el("p", { class: "muted small" }, t("system.mirrorHint")),
    ),
    el("section", { class: "card stack" },
      el("div", { class: "row-actions system-nav" },
        el("button", {
          type: "button", class: "btn", disabled: r === 1, "aria-label": t("system.prev"), onClick: () => goTo(r - 1),
        }, "◀"),
        el("strong", { class: "grow" },
          tf("system.rotation", { r, n: count }), " ",
          el("span", { class: "muted small" }, tf("system.anchor", { z: labels[0], pos: ANCHOR_POS[r - 1] }))),
        el("button", {
          type: "button", class: "btn", disabled: r === count, "aria-label": t("system.next"), onClick: () => goTo(r + 1),
        }, "▶"),
      ),
      grid(t("system.official"), official, false),
      grid(t("system.receive"), system.receive[r], true),
      grid(t("system.play"), system.play[r], true),
      el("div", { class: "row-actions" },
        el("button", { type: "button", class: "btn", onClick: resetRotation }, t("system.reset")),
        el("a", { class: "btn btn-primary", href: `#/team/${teamId}` }, t("system.done")),
      ),
    ),
  );
}
