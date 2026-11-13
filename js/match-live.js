/*
  match-live.js – der laufende Satz: Spielstand, Spielfeld mit Aufstellung,
  Ballberührungen (Spieler antippen -> Kreismenü), laufender Ballwechsel,
  Punkt (Vorschlag oder Knopf), Auswechslung, Libero-Tausch, Seiten tauschen.

  Alle Regeln kommen aus rules.js. Hier wird nur angezeigt und das passende
  Ereignis gespeichert (ctx.addEvent).
*/
import { el, showError } from "./dom.js";
import { t, tf } from "./i18n.js";
import * as db from "./db.js";
import {
  OWN, OPP, TEAMS, otherTeam, rallyError, substitutionError, suggestAction, suggestLiberoSwap,
  suggestPoint, validLiberoSwaps,
} from "./rules.js";
import { ACTIONS, qualityByCode } from "./ratings.js";
import { createRadialMenu } from "./radial-menu.js";
import { playerLabel, touchText } from "./match-format.js";

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
      onSelect: ({ quality }) => {
        const { ctx, team, playerId, action } = touchDraft;
        touchDraft = null;
        ctx.addEvent({ type: "touch", team, playerId, action, quality: quality.code });
      },
    });
  }
  return menu;
}

// Finger setzt auf einem Spieler (oder "Mannschaft") auf -> Kreismenü mit Aktionsvorschlag
function startTouch(event, ctx, team, playerId) {
  event.preventDefault(); // verhindert Textauswahl/Scrollen beim Ziehen
  const set = ctx.state.activeSet;
  touchDraft = { ctx, team, playerId, action: suggestAction(set, team, playerId) };
  getMenu().start(event, { team, playerId });
}

// Darf gerade eine Berührung erfasst werden? (nicht bei Libero-Pflicht oder entschiedenem Ballwechsel)
function touchBlocked(set) {
  return Boolean(rallyError(set) || suggestPoint(set));
}

/*
  Was gerade geöffnet ist (bleibt beim Neuzeichnen erhalten):
    null  oder  { matchId, type: "sub" | "libero", team, outId, exceptional }
*/
let panel = null;

// Libero-Vorschläge, die mit "Kein Wechsel" weggeklickt wurden (bis zum nächsten Ballwechsel).
const dismissed = new Set();

export function liveCard(ctx) {
  const set = ctx.state.activeSet;
  const { match } = ctx;
  if (panel && panel.matchId !== match.id) panel = null;

  const topTeam = match.ownSideTop ? OWN : OPP;
  const blocker = rallyError(set);

  const pointButtons = el("div", { class: "point-buttons" }, TEAMS.map((team) =>
    el("button", {
      type: "button", class: "btn btn-primary btn-big", disabled: Boolean(blocker),
      onClick: () => ctx.addEvent({ type: "point", winner: team }),
    }, tf("live.point", { team: ctx.names[team] }))));

  return el("section", { class: "card stack live" },
    scoreboard(ctx, set),
    courtHalf(ctx, set, topTeam, true),
    el("div", { class: "net" }),
    courtHalf(ctx, set, otherTeam(topTeam), false),
    TEAMS.map((team) => suggestionBox(ctx, set, team)),
    blocker === "liberoMustExit" && el("p", { class: "form-warning" }, t("live.liberoBlocks")),
    rallyView(ctx, set),
    pointSuggestion(ctx, set),
    pointButtons,
    el("p", { class: "muted small" }, t("live.pointHint")),
    actionButtons(ctx, set),
    panel?.type === "sub" && subPanel(ctx, set, panel.team),
    panel?.type === "libero" && liberoPanel(ctx, set, panel.team),
  );
}

/* ---------- Spielstand ---------- */

function scoreboard(ctx, set) {
  const teamScore = (team) => el("div", { class: `score-team${set.serving === team ? " serving" : ""}` },
    el("span", { class: "score-name" }, ctx.names[team]),
    el("span", { class: "score-points" }, set.score[team]),
    set.serving === team && el("span", { class: "score-serve" }, `🏐 ${t("live.serving")}`),
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
  Eine Feldhälfte. Beide Teams schauen zum Netz:
    oben (Netz unten):  1 6 5 / 2 3 4
    unten (Netz oben):  4 3 2 / 5 6 1
*/
function courtHalf(ctx, set, team, top) {
  const ts = set.teams[team];
  const label = el("div", { class: "court-label" }, ctx.names[team]);
  const blocked = touchBlocked(set);
  // Antippen startet das Kreismenü (pointerdown = Finger oder Maus drückt)
  const tapHandler = (playerId) => (event) => { if (!blocked) startTouch(event, ctx, team, playerId); };

  if (!ts.lineup) {
    // Ohne Aufstellung: "Mannschaft" antippen, bei einzelnen Gegnerspielern auch den Spieler
    const players = ctx.settings.opponentMode === "players" ? ctx.players.filter((p) => p.side === team) : [];
    return el("div", { class: "court-half" },
      label,
      el("p", { class: "muted small" }, t("live.noLineup")),
      el("div", { class: "chip-list touch-list" },
        el("button", {
          type: "button", class: "chip chip-touch chip-team", disabled: blocked, onPointerdown: tapHandler(null),
        }, tf("live.wholeTeam", { team: ctx.names[team] })),
        players.map((p) => el("button", {
          type: "button", class: "chip chip-touch", disabled: blocked, onPointerdown: tapHandler(p.id),
        }, playerLabel(p))),
      ),
    );
  }

  const order = top ? [0, 5, 4, 1, 2, 3] : [3, 2, 1, 4, 5, 0];
  const spots = order.map((index) => {
    const player = ctx.playerById.get(ts.lineup[index]);
    const isServer = index === 0 && set.serving === team;
    const classes = ["court-spot", player?.isLibero && "libero", isServer && "server"].filter(Boolean).join(" ");
    return el("button", { type: "button", class: classes, disabled: blocked, onPointerdown: tapHandler(ts.lineup[index]) },
      el("span", { class: "spot-pos" }, index + 1),
      el("span", { class: "spot-number" }, player?.number ?? "?"),
      el("span", { class: "spot-name" }, player?.name ?? ""),
      isServer && el("span", { class: "spot-serve" }, "🏐"),
    );
  });

  return el("div", { class: "court-half" },
    top && label,
    el("div", { class: "lineup-court" }, spots),
    !top && label,
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
      el("span", { class: "log-dot", style: `background: ${qualityByCode(touch.quality)?.color ?? "transparent"}` }),
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
        onClick: () => ctx.addEvent({ type: "point", winner: suggestion.winner }),
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

/* ---------- Knöpfe: Wechsel, Libero, Seiten tauschen ---------- */

function actionButtons(ctx, set) {
  const open = (type, team) => () => {
    const same = panel?.type === type && panel.team === team;
    panel = same ? null : { matchId: ctx.match.id, type, team, outId: null, exceptional: false };
    ctx.rerender();
  };

  const buttons = [];
  for (const team of TEAMS) {
    const ts = set.teams[team];
    if (!ts.lineup) continue; // ohne Aufstellung keine Wechsel
    // Wechsel nur zwischen den Ballwechseln
    buttons.push(el("button", { type: "button", class: "btn", disabled: set.rally.length > 0, onClick: open("sub", team) },
      tf("live.subButton", { team: ctx.names[team], count: ts.subCount, max: ctx.match.rules.maxSubstitutions })));
    if (validLiberoSwaps(set, team).length) {
      buttons.push(el("button", { type: "button", class: "btn", onClick: open("libero", team) },
        tf("live.liberoButton", { team: ctx.names[team] })));
    }
  }
  buttons.push(el("button", {
    type: "button", class: "btn",
    onClick: async () => {
      await db.saveMatch({ id: ctx.match.id, ownSideTop: !ctx.match.ownSideTop });
      ctx.rerender();
    },
  }, `⇅ ${t("live.swapSides")}`));

  return el("div", { class: "row-actions" }, buttons);
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
