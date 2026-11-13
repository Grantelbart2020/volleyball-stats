/*
  match-live.js – der laufende Satz: Spielstand, Spielfeld mit Aufstellung,
  Ballberührungen (Spieler antippen -> Kreismenü), laufender Ballwechsel,
  Punkt (Vorschlag oder Knopf mit Grund), Auszeit, Auswechslung, Libero-Tausch,
  Seiten tauschen.

  Alle Regeln kommen aus rules.js. Hier wird nur angezeigt und das passende
  Ereignis gespeichert (ctx.addEvent).
*/
import { el, showError } from "./dom.js";
import { t, tf } from "./i18n.js";
import * as db from "./db.js";
import {
  OWN, OPP, TEAMS, COACH, POINT_REASONS, causeCandidates, maxTimeouts, otherTeam, eventError, pointReason,
  rallyError, substitutionError, suggestAction, suggestLiberoSwap, suggestPoint, timeoutError, touchOutcome,
  validLiberoSwaps,
} from "./rules.js";
import { ACTIONS, codesFor, qualityDisplay } from "./ratings.js";
import { createRadialMenu } from "./radial-menu.js";
import { zoneAsked, zoneKind } from "./zones.js";
import { zoneField } from "./zone-picker.js";
import { causeLabel, playerLabel, touchText } from "./match-format.js";

/* ---------- Punkt per Knopf: Grund und Verursacher ---------- */

/*
  Nach "Punkt …" muss ein Grund gewählt werden (Nutzerentscheidung).
  Bei Netz, Übertritt und Karte zusätzlich, wer den Fehler gemacht hat:
  Spieler auf dem Feld direkt antippen, Bank/Trainer in der Leiste.
  "pendingPoint" merkt sich das (bleibt beim Neuzeichnen erhalten):
    null  oder  { matchId, winner, reason }   (reason null = Grund noch offen)
*/
let pendingPoint = null;

function savePoint(ctx, causeId) {
  const { winner, reason } = pendingPoint;
  pendingPoint = null;
  ctx.addEvent(causeId ? { type: "point", winner, reason, causeId } : { type: "point", winner, reason });
}

function chooseReason(ctx, reasonId) {
  pendingPoint.reason = reasonId;
  if (pointReason(reasonId).needsPerson) ctx.rerender(); // jetzt die Person wählen
  else savePoint(ctx, null);
}

// Wer darf als Verursacher gewählt werden? (null = gerade keine Personenwahl)
function causeChoice(ctx, set) {
  if (!pendingPoint?.reason || !pointReason(pendingPoint.reason).needsPerson) return null;
  const team = otherTeam(pendingPoint.winner);
  const teamIds = ctx.players.filter((p) => p.side === team).map((p) => p.id);
  return { team, ids: causeCandidates(set, team, pendingPoint.reason, teamIds) };
}

// Leiste anstelle der Punkt-Knöpfe: erst Grund, dann ggf. Person
function pointBar(ctx, set) {
  const loser = otherTeam(pendingPoint.winner);
  const cancel = el("button", {
    type: "button", class: "btn", onClick: () => { pendingPoint = null; ctx.rerender(); },
  }, t("common.cancel"));

  if (!pendingPoint.reason) {
    return el("div", { class: "zone-bar stack" },
      el("p", {}, el("strong", {}, tf("point.whyTitle", { team: ctx.names[pendingPoint.winner] })),
        " ", el("span", { class: "muted small" }, tf("point.whyHint", { team: ctx.names[loser] }))),
      el("div", { class: "chip-list" }, POINT_REASONS.map((r) =>
        el("button", { type: "button", class: "btn", onClick: () => chooseReason(ctx, r.id) }, t(`point.reason.${r.id}`)))),
      el("div", { class: "row-actions" }, cancel),
    );
  }

  // Person wählen: Spieler auf dem Feld werden direkt dort angetippt,
  // alle anderen (Bank, Trainer, Gegner ohne Aufstellung) stehen hier.
  const choice = causeChoice(ctx, set);
  const onCourt = set.teams[loser].lineup ?? [];
  const extra = choice.ids.filter((id) => !onCourt.includes(id));
  return el("div", { class: "zone-bar stack" },
    el("p", {}, el("strong", {}, tf("point.whoTitle", {
      reason: t(`point.reason.${pendingPoint.reason}`), team: ctx.names[loser],
    })), " ", el("span", { class: "muted small" }, t(onCourt.length ? "point.whoHintCourt" : "point.whoHint"))),
    extra.length > 0 && el("div", { class: "chip-list" }, extra.map((id) =>
      el("button", { type: "button", class: "btn", onClick: () => savePoint(ctx, id) },
        causeLabel(id, ctx.playerById)))),
    el("div", { class: "row-actions" },
      el("button", {
        type: "button", class: "btn", onClick: () => { pendingPoint.reason = null; ctx.rerender(); },
      }, t("point.otherReason")),
      cancel,
    ),
  );
}

/* ---------- Kreismenü für die Ballberührung ---------- */

/*
  Das Kreismenü wird nur EINMAL erzeugt (es hängt am <body>) und bei jedem
  Antippen wiederverwendet. "touchDraft" merkt sich, wer gerade angetippt wurde
  und welche Aktion in der Mitte steht:
    { ctx, team, playerId, action }
*/
let menu = null;
let touchDraft = null;

function getMenu() {
  if (!menu) {
    menu = createRadialMenu({
      getActionLabel: () => (touchDraft ? t(`action.${touchDraft.action}`) : ""),
      // Mitte antippen -> nächste Aktion; nach der letzten wieder von vorn
      onCenterTap: () => {
        const next = (ACTIONS.indexOf(touchDraft.action) + 1) % ACTIONS.length;
        touchDraft.action = ACTIONS[next];
      },
      // Segment 0–5 -> Code; beim Aufschlag ist die Reihenfolge anders (ratings.js)
      onSelect: ({ index }) => {
        const draft = touchDraft;
        touchDraft = null;
        const touch = {
          type: "touch", team: draft.team, playerId: draft.playerId,
          action: draft.action, quality: codesFor(draft.action)[index],
        };
        // Erst prüfen: Eine Berührung, die ohnehin abgelehnt wird, braucht keine Zone.
        // (addEvent zeigt den Fehler dann an.)
        const { ctx } = draft;
        const problem = eventError(ctx.state, touch, ctx.players, ctx.match.rules);
        if (!problem && zoneAsked(touch.action, touch.quality)) askZone(ctx, touch);
        else ctx.addEvent(touch);
      },
    });
  }
  return menu;
}

/*
  Zweiter Schritt: Zone wählen (oder "Ohne Zone"). Das Raster erscheint direkt
  auf der passenden Feldhälfte des Spielfelds (zone-picker.js):
    Aufschlag/Angriff: Feldhälfte des Gegners (wohin der Ball geht)
    Annahme/Abwehr:    eigene Feldhälfte (wo der Ball ankommt)
  Gespeichert wird die Berührung erst danach, als EIN Ereignis.
  "pendingZone" merkt sich die wartende Berührung (bleibt beim Neuzeichnen erhalten):
    null  oder  { matchId, touch, kind, half }
*/
let pendingZone = null;

function askZone(ctx, touch) {
  const kind = zoneKind(touch.action);
  pendingZone = { matchId: ctx.match.id, touch, kind, half: kind === "target" ? otherTeam(touch.team) : touch.team };
  ctx.rerender();
}

// Zone gewählt (zone = null: ohne Zone) -> Berührung speichern
function finishZone(ctx, zone) {
  if (!pendingZone) return;
  const { touch } = pendingZone;
  pendingZone = null;
  ctx.addEvent(zone ? { ...touch, zone } : touch);
}

function cancelZone(ctx) {
  pendingZone = null;
  ctx.rerender();
}

// Leiste unter dem Spielfeld, solange eine Zone gewählt wird
function zoneBar(ctx) {
  const { touch, kind, half } = pendingZone;
  const quality = qualityDisplay(touch.quality, touch.action);
  return el("div", { class: "zone-bar" },
    el("p", {},
      el("strong", {}, tf("zone.title", {
        action: t(`action.${touch.action}`),
        quality: `${quality.symbol} ${t(`quality.${touch.action}.${quality.id}`)}`,
        team: ctx.names[half],
      })),
      " ",
      el("span", { class: "muted small" }, t(kind === "pass" ? "zone.passHint" : "zone.targetHint")),
    ),
    el("div", { class: "row-actions" },
      el("button", { type: "button", class: "btn btn-primary", onClick: () => finishZone(ctx, null) }, t("zone.skip")),
      el("button", { type: "button", class: "btn", onClick: () => cancelZone(ctx) }, t("common.cancel")),
    ),
  );
}

// Finger setzt auf einem Spieler (oder "Mannschaft") auf -> Kreismenü mit Aktionsvorschlag
function startTouch(event, ctx, team, playerId) {
  event.preventDefault(); // verhindert Textauswahl/Scrollen beim Ziehen
  const set = ctx.state.activeSet;
  touchDraft = { ctx, team, playerId, action: suggestAction(set, team, playerId) };
  getMenu().start(event, { team, playerId });
}

/*
  Darf gerade eine Berührung dieses Teams erfasst werden?
  Nicht bei Libero-Pflicht. Ist der Ballwechsel schon entschieden, nur noch
  EINE Spiegel-Berührung des anderen Teams (z. B. Blockpunkt nach "geblockt").
  Die genaue Prüfung (passt die Bewertung?) macht rules.js beim Speichern.
*/
function touchBlocked(set, team) {
  if (pendingZone || pendingPoint) return true; // erst Zone bzw. Punktgrund fertig wählen
  if (rallyError(set)) return true;
  if (!suggestPoint(set)) return false;
  const last = set.rally[set.rally.length - 1];
  const previous = set.rally.length >= 2 ? set.rally[set.rally.length - 2] : null;
  const mirrorDone = previous && touchOutcome(previous);
  return Boolean(mirrorDone) || last.team === team;
}

/*
  Was gerade geöffnet ist (bleibt beim Neuzeichnen erhalten):
    null  oder  { matchId, type: "sub" | "libero", team, outId, exceptional }
*/
let panel = null;

// Libero-Vorschläge, die mit "Kein Wechsel" weggeklickt wurden (bis zum nächsten Ballwechsel).
const dismissed = new Set();

/*
  Hoch- oder Querformat? matchMedia fragt den Browser (wie eine CSS-Media-Query).
  Dreht man das Handy, wird die Live-Seite neu gezeichnet (rerenderLive merkt
  sich dafür die Funktion der zuletzt gezeichneten Live-Seite).
*/
const landscapeQuery = window.matchMedia("(orientation: landscape)");
let rerenderLive = null;

function onOrientationChange() {
  if (rerenderLive && document.body.classList.contains("live-mode")) rerenderLive();
}
// addListener = Ersatz für ältere Safari-Versionen
if (landscapeQuery.addEventListener) landscapeQuery.addEventListener("change", onOrientationChange);
else landscapeQuery.addListener?.(onOrientationChange);

/*
  Die Live-Seite (#/match/<id>/live): füllt genau den Bildschirm und scrollt
  nicht (style.css, body.live-mode).

  Hochformat, von oben nach unten:
    1. Kopf:   ☰ Spiel (zur Spielseite) | Spielstand | ↶ Rückgängig
    2. Spielfeld: obere Hälfte, Netz (mit Knopf "Seiten tauschen"), untere Hälfte.
       Jede Hälfte hat eine Leiste mit Teamname und Symbol-Knöpfen
       (⏸ Auszeit, 🔄 Wechsel, L Libero).
    3. Info:   Zonen-/Grundabfrage, Vorschläge, laufender Ballwechsel, Fehler,
               Wechsel-/Libero-Auswahl (nur DIESER Bereich scrollt, wenn nötig)
    4. Fuß:    Punkt-Knöpfe
  Querformat (Klasse "landscape", Aufteilung in style.css):
    links das Spielfeld (Netz senkrecht, Teams links/rechts, Symbol-Knöpfe
    unten links bzw. unten rechts unter dem jeweiligen Team), darunter die
    Punkt-Knöpfe; rechts eine schmale Spalte mit Kopf und Info.
  Alles andere (Kader, Verlauf, Bearbeiten, Export, Löschen) steht auf der
  Spielseite.
*/
export function liveScreen(ctx) {
  const set = ctx.state.activeSet;
  const { match } = ctx;
  if (panel && panel.matchId !== match.id) panel = null;
  if (pendingZone && pendingZone.matchId !== match.id) pendingZone = null;
  if (pendingPoint && (pendingPoint.matchId !== match.id || rallyError(set))) pendingPoint = null;
  rerenderLive = ctx.rerender;

  const landscape = landscapeQuery.matches;
  // "ownSideTop" heißt im Querformat: eigenes Team links (Handy nach links gedreht)
  const firstTeam = match.ownSideTop ? OWN : OPP;
  const secondTeam = otherTeam(firstTeam);
  const [firstSide, secondSide] = landscape ? ["left", "right"] : ["top", "bottom"];
  const blocker = rallyError(set);

  // "Punkt …" öffnet die Abfrage des Grundes (pointBar im Info-Bereich), gespeichert wird danach.
  // Reihenfolge wie auf dem Feld: erst das obere bzw. linke Team.
  const pointButtons = !pendingPoint && el("div", { class: "point-buttons" }, [firstTeam, secondTeam].map((team) =>
    el("button", {
      type: "button", class: "btn btn-primary btn-big", disabled: Boolean(blocker || pendingZone),
      onClick: () => { pendingPoint = { matchId: match.id, winner: team, reason: null }; ctx.rerender(); },
    }, tf("live.point", { team: ctx.names[team] }))));

  const head = el("div", { class: "live-head" },
    el("a", { class: "btn btn-small", href: `#/match/${match.id}` }, `☰ ${t("live.menu")}`),
    scoreboard(ctx, set),
    el("button", {
      type: "button", class: "btn btn-small", title: t("undo.button"), "aria-label": t("undo.button"),
      onClick: async () => {
        pendingZone = null;
        pendingPoint = null;
        await db.deleteLastMatchEvent(match.id);
        ctx.rerender();
      },
    }, "↶"),
  );

  // Seiten tauschen: Knopf mitten auf dem Netz (dreht nur die Anzeige)
  const swapSides = el("button", {
    type: "button", class: "btn btn-icon net-swap",
    title: t("live.swapSides"), "aria-label": t("live.swapSides"),
    onClick: async () => {
      await db.saveMatch({ id: ctx.match.id, ownSideTop: !ctx.match.ownSideTop });
      ctx.rerender();
    },
  }, landscape ? "⇆" : "⇅");

  return el("div", { class: `live-screen${landscape ? " landscape" : ""}` },
    head,
    el("div", { class: "live-court" },
      courtHalf(ctx, set, firstTeam, firstSide),
      el("div", { class: "live-net" }, swapSides),
      courtHalf(ctx, set, secondTeam, secondSide),
    ),
    el("div", { class: "live-info" },
      pendingZone && zoneBar(ctx),
      pendingPoint && pointBar(ctx, set),
      // Selbst geöffnete Auswahl (Wechsel/Libero) zuerst, damit sie ohne Scrollen zu sehen ist
      panel?.type === "sub" && subPanel(ctx, set, panel.team),
      panel?.type === "libero" && liberoPanel(ctx, set, panel.team),
      !pendingZone && !pendingPoint && TEAMS.map((team) => suggestionBox(ctx, set, team)),
      blocker === "liberoMustExit" && el("p", { class: "form-warning" }, t("live.liberoBlocks")),
      // Wurde die letzte Eingabe abgelehnt (z. B. unpassende Spiegel-Berührung)? Einmal anzeigen.
      ctx.problem && el("p", { class: "form-error" }, t(`error.${ctx.problem}`)),
      pointSuggestion(ctx, set),
      rallyView(ctx, set),
    ),
    el("div", { class: "live-foot" }, pointButtons),
  );
}

/* ---------- Spielstand ---------- */

function scoreboard(ctx, set) {
  // Aufschlag: nur das Ball-Symbol, außen neben der Zahl (liegt "über" dem Platz,
  // verschiebt die Zahl also nicht – beide Zahlen bleiben auf gleicher Höhe)
  const teamScore = (team) => el("div", { class: `score-team${set.serving === team ? " serving" : ""}` },
    el("span", { class: "score-name" }, ctx.names[team]),
    el("span", { class: "score-points" },
      set.score[team],
      set.serving === team && el("span", {
        class: `score-serve ${team === OWN ? "before" : "after"}`,
        title: t("live.serving"), "aria-label": t("live.serving"),
      }, "🏐"),
    ),
  );
  return el("div", {},
    el("div", { class: "scoreboard" }, teamScore(OWN), el("span", { class: "score-sep" }, ":"), teamScore(OPP)),
    el("p", { class: "muted small center" }, tf("live.setInfo", {
      n: set.number, target: set.target, own: ctx.state.setsWon.own, opp: ctx.state.setsWon.opp,
    })),
  );
}

/* ---------- Spielfeld ---------- */

/*
  Eine Feldhälfte. Beide Teams schauen zum Netz. "side" = Lage auf dem Bildschirm.
  LAYOUTS: in welcher Reihenfolge die Positionen (Index 0 = Position 1) im
  Raster stehen, und wie viele Spalten es hat:
    top    (Netz unten):  1 6 5 / 2 3 4
    bottom (Netz oben):   4 3 2 / 5 6 1
    left   (Netz rechts): 5 4 / 6 3 / 1 2
    right  (Netz links):  2 1 / 3 6 / 4 5
*/
const LAYOUTS = {
  top: { order: [0, 5, 4, 1, 2, 3], columns: 3 },
  bottom: { order: [3, 2, 1, 4, 5, 0], columns: 3 },
  left: { order: [4, 3, 5, 2, 0, 1], columns: 2 },
  right: { order: [1, 0, 2, 5, 3, 4], columns: 2 },
};

function courtHalf(ctx, set, team, side) {
  const ts = set.teams[team];
  // Leiste der Hälfte: Teamname + Symbol-Knöpfe (oben bei der oberen Hälfte, sonst unten)
  const bar = el("div", { class: "court-bar" },
    el("div", { class: "court-label" }, ctx.names[team]),
    teamTools(ctx, set, team),
  );
  const barFirst = side === "top";
  // Wird gerade der Verursacher eines Punktes gewählt? Dann wählt Antippen die Person.
  const cause = causeChoice(ctx, set);
  const causeMode = cause?.team === team;
  const blocked = causeMode ? false : touchBlocked(set, team);
  // Antippen startet das Kreismenü (pointerdown = Finger oder Maus drückt)
  const tapHandler = (playerId) => (event) => {
    if (causeMode) {
      event.preventDefault();
      if (cause.ids.includes(playerId)) savePoint(ctx, playerId);
    } else if (!blocked) {
      startTouch(event, ctx, team, playerId);
    }
  };

  /*
    Wird gerade eine Zone auf DIESER Hälfte gewählt, liegt das Zonenraster über
    den Spielern (die bleiben blass sichtbar, damit man sich orientieren kann).
  */
  const withZone = (content) => {
    if (pendingZone?.half !== team) return content;
    return el("div", { class: "zone-wrap" },
      el("div", { class: "zone-under" }, content),
      zoneField({
        kind: pendingZone.kind,
        mode: ctx.settings.zoneMode,
        side,
        onPick: (zone) => finishZone(ctx, zone),
      }),
    );
  };

  if (!ts.lineup) {
    // Ohne Aufstellung: "Mannschaft" antippen, bei einzelnen Gegnerspielern auch den Spieler
    const players = ctx.settings.opponentMode === "players" ? ctx.players.filter((p) => p.side === team) : [];
    return el("div", { class: `court-half side-${side}` },
      barFirst && bar,
      el("p", { class: "muted small" }, t("live.noLineup")),
      withZone(el("div", { class: "chip-list touch-list" },
        el("button", {
          // Als Verursacher zählt nur eine Person, nicht die ganze Mannschaft
          type: "button", class: "chip chip-touch chip-team", disabled: blocked || causeMode, onPointerdown: tapHandler(null),
        }, tf("live.wholeTeam", { team: ctx.names[team] })),
        players.map((p) => el("button", {
          type: "button", class: `chip chip-touch${causeMode ? " cause-pick" : ""}`, disabled: blocked,
          onPointerdown: tapHandler(p.id),
        }, playerLabel(p))),
      )),
      !barFirst && bar,
    );
  }

  const layout = LAYOUTS[side];
  const spots = layout.order.map((index) => {
    const player = ctx.playerById.get(ts.lineup[index]);
    const isServer = index === 0 && set.serving === team;
    const classes = ["court-spot", player?.isLibero && "libero", isServer && "server", causeMode && "cause-pick"]
      .filter(Boolean).join(" ");
    return el("button", { type: "button", class: classes, disabled: blocked, onPointerdown: tapHandler(ts.lineup[index]) },
      el("span", { class: "spot-pos" }, index + 1),
      el("span", { class: "spot-number" }, player?.number ?? "?"),
      el("span", { class: "spot-name" }, player?.name ?? ""),
      isServer && el("span", { class: "spot-serve" }, "🏐"),
    );
  });

  return el("div", { class: `court-half side-${side}` },
    barFirst && bar,
    withZone(el("div", {
      class: "lineup-court", style: `grid-template-columns: repeat(${layout.columns}, minmax(0, 1fr))`,
    }, spots)),
    !barFirst && bar,
  );
}

/* ---------- Laufender Ballwechsel und Punktvorschlag ---------- */

// Die Berührungen des laufenden Ballwechsels, der Reihe nach, mit Farbe der Bewertung.
function rallyView(ctx, set) {
  if (!set.rally.length) {
    return el("p", { class: "muted small" }, t(set.serving === OWN ? "live.tapServer" : "live.tapStart"));
  }
  return el("ol", { class: "rally" }, set.rally.map((touch) =>
    el("li", {},
      el("span", { class: "log-dot", style: `background: ${qualityDisplay(touch.quality, touch.action)?.color ?? "transparent"}` }),
      touchText(touch, ctx.names, ctx.playerById),
    )));
}

/*
  Hat die letzte Berührung den Ballwechsel entschieden (Ass, Angriffspunkt,
  Fehler ...), schlägt die App den Punkt vor. Weitere Berührungen sind bis
  dahin gesperrt. War die Bewertung falsch: "Rückgängig".
*/
function pointSuggestion(ctx, set) {
  const suggestion = suggestPoint(set);
  if (!suggestion || rallyError(set)) return null;
  return el("div", { class: "suggestion" },
    el("p", {}, tf("live.pointSuggest", { team: ctx.names[suggestion.winner] })),
    el("div", { class: "row-actions" },
      el("button", {
        type: "button", class: "btn btn-primary",
        onClick: () => ctx.addEvent({ type: "point", winner: suggestion.winner, reason: "touch" }),
      }, t("common.ok")),
    ),
    el("p", { class: "muted small" }, t("live.pointSuggestHint")),
  );
}

/* ---------- Libero-Vorschlag ---------- */

function suggestionBox(ctx, set, team) {
  const suggestion = suggestLiberoSwap(set, team);
  if (!suggestion) return null;
  const key = `${ctx.match.id}|${set.number}|${set.rallies}|${team}`;
  if (!suggestion.mandatory && dismissed.has(key)) return null;

  const p = (id) => playerLabel(ctx.playerById.get(id));
  const values = { team: ctx.names[team], in: p(suggestion.inId), out: p(suggestion.outId) };
  const swap = () => {
    panel = null;
    return ctx.addEvent({ type: "liberoSwap", team, outId: suggestion.outId, inId: suggestion.inId });
  };

  return el("div", { class: `suggestion${suggestion.mandatory ? " mandatory" : ""}` },
    el("p", {}, tf(suggestion.mandatory ? "live.liberoMustExit" : "live.liberoSuggest", values)),
    el("div", { class: "row-actions" },
      el("button", { type: "button", class: "btn btn-primary", onClick: swap }, t("common.ok")),
      !suggestion.mandatory && el("button", {
        type: "button", class: "btn",
        onClick: () => { panel = { matchId: ctx.match.id, type: "libero", team }; ctx.rerender(); },
      }, t("live.otherChoice")),
      !suggestion.mandatory && el("button", {
        type: "button", class: "btn",
        onClick: () => { dismissed.add(key); ctx.rerender(); },
      }, t("live.noSwap")),
    ),
  );
}

/* ---------- Symbol-Knöpfe eines Teams: Auszeit, Wechsel, Libero ---------- */

/*
  Kleiner Knopf mit Symbol und (optional) Zähler, z. B. "⏸ 1/2".
  Der ausführliche Text (mit Teamname) steht als Hinweis (title) und für
  Bildschirmleser (aria-label) dabei.
*/
function iconButton({ icon, count, label, disabled, active, onClick }) {
  return el("button", {
    type: "button", class: `btn btn-icon${active ? " active" : ""}`,
    title: label, "aria-label": label, disabled: Boolean(disabled), onClick,
  },
    el("span", { class: "icon" }, icon),
    count && el("span", { class: "icon-count" }, count),
  );
}

function teamTools(ctx, set, team) {
  const ts = set.teams[team];
  const rules = ctx.match.rules;
  const open = (type) => () => {
    const same = panel?.type === type && panel.team === team;
    panel = same ? null : { matchId: ctx.match.id, type, team, outId: null, exceptional: false };
    ctx.rerender();
  };
  const isOpen = (type) => panel?.type === type && panel.team === team;

  // Auszeit: auch ohne Aufstellung; nur zwischen den Ballwechseln (prüft timeoutError)
  const timeoutValues = { team: ctx.names[team], count: ts.timeouts, max: maxTimeouts(rules) };
  const buttons = [iconButton({
    icon: "⏸", count: `${ts.timeouts}/${timeoutValues.max}`,
    label: tf("live.timeoutButton", timeoutValues),
    disabled: timeoutError(set, team, rules) || pendingPoint,
    onClick: () => ctx.addEvent({ type: "timeout", team }),
  })];

  if (ts.lineup) { // ohne Aufstellung keine Wechsel
    // Wechsel nur zwischen den Ballwechseln
    buttons.push(iconButton({
      icon: "🔄", count: `${ts.subCount}/${rules.maxSubstitutions}`,
      label: tf("live.subButton", { team: ctx.names[team], count: ts.subCount, max: rules.maxSubstitutions }),
      disabled: set.rally.length > 0 || pendingPoint, active: isOpen("sub"),
      onClick: open("sub"),
    }));
    if (validLiberoSwaps(set, team).length) {
      buttons.push(iconButton({
        icon: "L", label: tf("live.liberoButton", { team: ctx.names[team] }),
        active: isOpen("libero"), onClick: open("libero"),
      }));
    }
  }
  return el("div", { class: "team-tools" }, buttons);
}

/* ---------- Auswechslung ---------- */

function subPanel(ctx, set, team) {
  const ts = set.teams[team];
  const rules = ctx.match.rules;
  const teamPlayers = ctx.players.filter((p) => p.side === team);
  const teamIds = teamPlayers.map((p) => p.id);
  const error = el("p", { class: "form-error", hidden: true });

  const exceptionalBox = el("input", {
    type: "checkbox", checked: panel.exceptional,
    onChange: () => { panel.exceptional = exceptionalBox.checked; ctx.rerender(); },
  });

  let content;
  if (!panel.outId) {
    // Schritt 1: Wer geht raus? (Libero wird nicht ausgewechselt, sondern getauscht)
    const onCourt = ts.lineup.filter((id) => !ts.liberoIds.includes(id));
    content = el("div", {},
      el("p", {}, t("live.subWhoOut")),
      el("div", { class: "chip-list" }, onCourt.map((id) =>
        el("button", {
          type: "button", class: "btn",
          onClick: () => { panel.outId = id; ctx.rerender(); },
        }, playerLabel(ctx.playerById.get(id))))),
    );
  } else {
    // Schritt 2: Wer kommt? Nur erlaubte Spieler werden angeboten.
    const change = (inId) => ({ outId: panel.outId, inId, exceptional: panel.exceptional });
    const candidates = teamPlayers.filter((p) =>
      substitutionError(set, team, change(p.id), rules, teamIds) === null);
    const limitReached = !panel.exceptional && ts.subCount >= rules.maxSubstitutions;

    content = el("div", {},
      el("p", {}, tf("live.subWhoIn", { out: playerLabel(ctx.playerById.get(panel.outId)) })),
      candidates.length
        ? el("div", { class: "chip-list" }, candidates.map((p) =>
            el("button", {
              type: "button", class: "btn btn-primary",
              onClick: async () => {
                const event = { type: "substitution", team, ...change(p.id) };
                const problem = substitutionError(set, team, event, rules, teamIds);
                if (problem) return showError(error, t(`error.${problem}`));
                panel = null;
                await ctx.addEvent(event);
              },
            }, playerLabel(p))))
        : el("p", { class: "form-warning" }, t(limitReached ? "error.subLimit" : "live.noValidSub")),
      el("button", {
        type: "button", class: "btn",
        onClick: () => { panel.outId = null; ctx.rerender(); },
      }, t("live.subOtherOut")),
    );
  }

  return el("div", { class: "panel stack" },
    el("h3", {}, tf("live.subTitle", { team: ctx.names[team], count: ts.subCount, max: rules.maxSubstitutions })),
    content,
    el("label", { class: "checkbox" }, exceptionalBox, ` ${t("live.exceptional")}`),
    panel.exceptional && el("p", { class: "muted small" }, t("live.exceptionalHint")),
    error,
    el("button", { type: "button", class: "btn", onClick: () => { panel = null; ctx.rerender(); } }, t("common.cancel")),
  );
}

/* ---------- Libero-Tausch (Auswahl) ---------- */

function liberoPanel(ctx, set, team) {
  const options = validLiberoSwaps(set, team);
  const p = (id) => playerLabel(ctx.playerById.get(id));
  return el("div", { class: "panel stack" },
    el("h3", {}, tf("live.liberoButton", { team: ctx.names[team] })),
    options.length
      ? el("div", { class: "chip-list" }, options.map((o) =>
          el("button", {
            type: "button", class: "btn",
            onClick: async () => {
              panel = null;
              await ctx.addEvent({ type: "liberoSwap", team, outId: o.outId, inId: o.inId });
            },
          }, tf("live.swapOption", { in: p(o.inId), out: p(o.outId) }))))
      : el("p", { class: "muted" }, t("live.noLiberoSwap")),
    el("button", { type: "button", class: "btn", onClick: () => { panel = null; ctx.rerender(); } }, t("common.cancel")),
  );
}
