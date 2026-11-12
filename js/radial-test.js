/*
  radial-test.js – VORLÄUFIGER Testbildschirm für Meilenstein 1a.

  Zeigt ein halbes Spielfeld mit 6 Beispielspielern und eine Liste der letzten Eingaben.
  Es wird hier absichtlich nichts gespeichert. Diese Datei wird später durch capture.js
  und court.js ersetzt; radial-menu.js und ratings.js bleiben erhalten.
*/
import { ACTIONS } from "./ratings.js";
import { createRadialMenu } from "./radial-menu.js";
import { t } from "./i18n.js";
import { el } from "./dom.js";

// Beispielspieler. Die Reihenfolge entspricht dem Spielfeld:
// vorne (am Netz) Positionen 4, 3, 2 – hinten Positionen 5, 6, 1.
const TEST_PLAYERS = [
  { position: 4, number: 7 },
  { position: 3, number: 12 },
  { position: 2, number: 9 },
  { position: 5, number: 4 },
  { position: 6, number: 1 },
  { position: 1, number: 10 },
];

let actionIndex = 1;   // Start mit "reception" (Annahme)
const entries = [];    // die letzten Eingaben (nur im Speicher, noch keine Datenbank)

function currentActionLabel() {
  return t(`action.${ACTIONS[actionIndex]}`);
}

// Zeichnet die Liste der letzten Eingaben neu (neueste oben, max. 10).
function renderLog() {
  const log = document.getElementById("log");
  if (!log) return; // Testbildschirm gerade nicht sichtbar
  log.innerHTML = ""; // Liste leeren

  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "log-empty";
    empty.textContent = t("test.logEmpty");
    log.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    // Farbiger Punkt + Text, z. B. "#7 · Annahme · + Positiv  (+)"
    const dot = document.createElement("span");
    dot.className = "log-dot";
    dot.style.background = entry.quality.color;
    item.appendChild(dot);
    item.append(
      `#${entry.number} · ${t(`action.${entry.action}`)} · ` +
      `${entry.quality.symbol} ${t(`quality.${entry.quality.id}`)}  (${entry.quality.code})`
    );
    log.appendChild(item);
  }
}

// Das Kreismenü wird nur EINMAL erzeugt und dann wiederverwendet,
// auch wenn der Bildschirm neu gezeichnet wird (z. B. nach Sprachwechsel).
let menu = null;

function getMenu() {
  if (!menu) {
    menu = createRadialMenu({
      getActionLabel: currentActionLabel,
      // Mitte antippen -> nächste Aktion; nach der letzten wieder von vorn
      onCenterTap: () => { actionIndex = (actionIndex + 1) % ACTIONS.length; },
      onSelect: ({ player, quality }) => {
        entries.unshift({ number: player.number, action: ACTIONS[actionIndex], quality });
        entries.length = Math.min(entries.length, 10); // höchstens 10 behalten
        renderLog();
      },
    });
  }
  return menu;
}

// Baut den Testbildschirm in "container" auf. Adresse: #/test
export function renderRadialTest(container) {
  const court = el("div", { id: "court", class: "court" });

  // Spielerkreise erzeugen
  for (const player of TEST_PLAYERS) {
    const button = el("button", { type: "button", class: "player" }, player.number);
    // Finger setzt auf -> Rad öffnen
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault(); // verhindert Textauswahl/Scrollen beim Ziehen
      getMenu().start(event, player);
    });
    court.appendChild(button);
  }

  // Langes Drücken soll kein Kontextmenü des Browsers öffnen
  court.addEventListener("contextmenu", (event) => event.preventDefault());

  container.replaceChildren(
    el("a", { class: "back-link", href: "#/" }, `← ${t("nav.teams")}`),
    el("section", { class: "card" },
      el("h2", {}, t("test.title")),
      el("p", {}, t("test.hint")),
      el("div", { class: "net" }),
      court,
    ),
    el("section", { class: "card" },
      el("h2", {}, t("test.logTitle")),
      el("ol", { id: "log", class: "log" }),
    ),
  );

  renderLog();
}
