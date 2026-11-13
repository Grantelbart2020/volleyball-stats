/*
  screen-report.js – Spielbericht zum Ansehen und Drucken.
  Adresse: #/match/<id>/report

  Die Seite ist für den Druck gebaut (A4 quer, helle Farben, siehe style.css
  "@media print"). Über "Drucken → Als PDF speichern" wird daraus eine PDF.
  So braucht die App keine fremde PDF-Bibliothek.

  Inhalt:
  A. Gesamttabelle: Spieler × Aktion × Stufe, Effektivität, Effizienz, Bilanz
     Side-out und Break pro Satz
  B. Verkettung:
     1. Annahme → Ballwechsel
     2. Zuspiel nach Vorlage
     3. Angriff nach Vorlage
     4. Aufschlag → gegnerische Annahme → Break

  Alle Zahlen kommen aus stats.js. Hier wird nur gezeichnet.
*/
import { el } from "./dom.js";
import { t, tf, getLanguage } from "./i18n.js";
import * as db from "./db.js";
import { OWN, computeMatch } from "./rules.js";
import { codesFor, qualityDisplay } from "./ratings.js";
import { formatDate, matchResultText, playerLabel, qualityLabel, qualityText } from "./match-format.js";
import {
  BUCKETS, INPUT_GROUPS, SERVE_GROUPS, actionSummary, attackChain, collectRallies, filterSet, phaseStats,
  playerTable, ratio, receptionChain, serveChain, setChain, setNumbers,
} from "./stats.js";

// Aktionen der beiden Tabellen: direkte Punkte und Ballkontrolle
const SCORING_ACTIONS = ["serve", "attack", "block"];
const CONTROL_ACTIONS = ["reception", "set", "dig", "freeball"];

// Gewählter Satz (null = ganzes Spiel). Bleibt beim Sprachwechsel erhalten.
let selectedSet = null;
let selectedMatchId = null;

/* ---------- Zahlen als Text ---------- */

// 0.536 -> "54 %", null -> "–"
function pct(value) {
  if (value === null || value === undefined) return "–";
  return value.toLocaleString(getLanguage(), { style: "percent", maximumFractionDigits: 0 });
}

// 0 -> "·" wie in der bisherigen Auswertung, damit die Tabelle ruhig wirkt
function count(n) {
  return n ? String(n) : "·";
}

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

/*
  Rangstufen (0 = beste) ohne feste Aktion, z. B. "Vorlage gut/mittel/schlecht":
  Farbe und Beschriftung wie beim Zuspiel (++ + = − rüber ✖).
*/
function rankLook(rank) {
  return qualityDisplay(codesFor("set")[rank], "set");
}

function rankColor(rank) {
  return rankLook(rank)?.color ?? "transparent";
}

// Kopfzelle für einen Code einer Aktion: Beschriftung wie im Kreismenü, farbiger Strich
function codeHeader(action, code) {
  const look = qualityDisplay(code, action);
  return el("th", { class: "code-head", title: code, style: `border-bottom-color: ${look?.color ?? "transparent"}` },
    look ? qualityLabel(look) : code);
}

// Kopfzelle für eine Rangstufe, z. B. bei der Vorlage
function rankHeader(rank) {
  return el("th", { class: "code-head", style: `border-bottom-color: ${rankColor(rank)}` }, qualityLabel(rankLook(rank)));
}

function section(title, hint, ...content) {
  return el("section", { class: "report-section" },
    el("h3", {}, title),
    hint && el("p", { class: "report-hint" }, hint),
    ...content,
  );
}

/* ---------- Bildschirm ---------- */

export async function renderReport(container, matchId) {
  const match = await db.getMatch(matchId);
  if (!match) {
    container.replaceChildren(el("section", { class: "card" }, el("p", {}, t("match.notFound"))));
    return;
  }
  if (selectedMatchId !== matchId) {
    selectedMatchId = matchId;
    selectedSet = null;
  }
  const [team, players, events] = await Promise.all([
    db.getTeam(match.teamId),
    db.listMatchPlayers(match.id),
    db.listMatchEvents(match.id),
  ]);
  const state = computeMatch(match.rules, players, events);
  const allRallies = collectRallies(match.rules, players, events);
  const rallies = filterSet(allRallies, selectedSet);

  const ctx = {
    match, state, allRallies, rallies,
    names: { own: team?.name ?? "?", opp: match.opponent },
    playerById: new Map(players.map((p) => [p.id, p])),
    ownPlayers: players.filter((p) => p.side === OWN),
  };
  const label = (id) => playerLabel(ctx.playerById.get(id));
  ctx.label = label;

  // Auswahl: ganzes Spiel oder ein Satz
  const setSelect = el("select", {
    onChange: () => {
      selectedSet = setSelect.value ? Number(setSelect.value) : null;
      renderReport(container, matchId);
    },
  },
    el("option", { value: "" }, t("report.wholeMatch")),
    setNumbers(allRallies).map((n) =>
      el("option", { value: n, selected: selectedSet === n }, tf("report.setN", { n }))),
  );

  const toolbar = el("div", { class: "card report-toolbar no-print" },
    el("a", { class: "btn", href: `#/match/${match.id}` }, `← ${t("report.backToMatch")}`),
    el("label", { class: "field-inline" }, el("span", {}, t("report.scope")), setSelect),
    el("button", { type: "button", class: "btn btn-primary", onClick: () => window.print() }, t("report.print")),
    el("p", { class: "muted small report-print-hint" }, t("report.printHint")),
  );

  const body = allRallies.length
    ? [
        totalsSection(ctx, SCORING_ACTIONS, true),
        totalsSection(ctx, CONTROL_ACTIONS, false),
        phaseSection(ctx),
        receptionSection(ctx),
        setSection(ctx),
        attackSection(ctx),
        serveSection(ctx),
        el("p", { class: "report-hint" }, t("report.definitions")),
      ]
    : [el("p", { class: "muted" }, t("report.noData"))];

  container.replaceChildren(
    toolbar,
    el("article", { class: "report" },
      reportHeader(ctx),
      ...body,
    ),
  );
}

/* ---------- Kopf ---------- */

function reportHeader(ctx) {
  const { match, state } = ctx;
  const details = [
    formatDate(match.date),
    match.homeAway && t(`match.homeAway.${match.homeAway}`),
    match.competition,
  ].filter(Boolean).join(" · ");
  const scope = selectedSet ? tf("report.setN", { n: selectedSet }) : t("report.wholeMatch");
  return el("header", { class: "report-header" },
    el("h2", {}, `${ctx.names.own} – ${ctx.names.opp}`),
    el("p", {}, el("strong", {}, matchResultText(state)), ` · ${details}`),
    el("p", { class: "report-hint" },
      `${t("report.title")} · ${scope} · ${tf("report.createdAt", { date: formatDate(new Date().toISOString()) })}`),
  );
}

/* ---------- A. Gesamttabelle ---------- */

/*
  Tabelle Spieler × Aktionen × 6 Stufen.
  withBalance: Spalten Punkte, Fehler, +/- (nur bei der Tabelle mit den Punkt-Aktionen)
  Aktionen ohne jede Berührung (z. B. Freeball) werden weggelassen.
*/
function totalsSection(ctx, actionList, withBalance) {
  const table = playerTable(ctx.rallies, OWN);
  const actions = actionList.filter((a) => table.totals.actions[a].total > 0);
  if (!actions.length && !withBalance) return null;

  // nur Spieler mit mindestens einer Berührung oder einem Fehler
  const rows = ctx.ownPlayers.filter((p) => table.players.has(p.id));

  const cells = (counts, action) => [
    ...codesFor(action).map((code) => el("td", {}, count(counts.byCode[code]))),
    el("td", { class: "total" }, String(counts.total)),
  ];
  const balance = (row) => withBalance ? [
    el("td", {}, String(row.points)),
    el("td", {}, String(row.faults)),
    el("td", { class: `total ${row.points - row.faults >= 0 ? "plus" : "minus"}` }, signed(row.points - row.faults)),
  ] : [];

  const head = el("thead", {},
    el("tr", {},
      el("th", { rowSpan: 2, class: "name" }, t("report.player")),
      actions.map((a) => el("th", { colSpan: 7, class: "group" }, t(`action.${a}`))),
      withBalance && el("th", { colSpan: 3, class: "group" }, t("report.balance")),
    ),
    el("tr", {},
      actions.map((a) => [...codesFor(a).map((code) => codeHeader(a, code)), el("th", {}, t("report.sum"))]),
      withBalance && [el("th", {}, t("report.points")), el("th", {}, t("report.faults")), el("th", {}, "+/-")],
    ),
  );

  const summaries = actions.map((a) => actionSummary(a, table.totals.actions[a]));
  const foot = el("tfoot", {},
    el("tr", { class: "total-row" },
      el("th", { class: "name" }, t("report.total")),
      actions.map((a) => cells(table.totals.actions[a], a)),
      balance(table.totals),
    ),
    el("tr", {},
      el("th", { class: "name" }, t("report.effectiveness")),
      summaries.map((s) => el("td", { colSpan: 7 }, pct(s.effectiveness))),
      withBalance && el("td", { colSpan: 3 }),
    ),
    el("tr", {},
      el("th", { class: "name" }, t("report.efficiency")),
      summaries.map((s) => el("td", { colSpan: 7 }, pct(s.efficiency))),
      withBalance && el("td", { colSpan: 3 }),
    ),
  );

  const bodyRows = rows.map((p) => {
    const row = table.players.get(p.id);
    return el("tr", {},
      el("th", { class: "name" }, playerLabel(p)),
      actions.map((a) => cells(row.actions[a], a)),
      balance(row),
    );
  });

  return section(
    withBalance ? t("report.tableScoring") : t("report.tableControl"),
    null,
    el("div", { class: "table-wrap" }, el("table", { class: "report-table" }, head, el("tbody", {}, bodyRows), foot)),
  );
}

/* ---------- Side-out und Break pro Satz ---------- */

function phaseSection(ctx) {
  // Immer alle Sätze zeigen, unabhängig von der Auswahl oben
  const numbers = setNumbers(ctx.allRallies);
  const line = (labelText, rallies, score, rowClass) => {
    const phase = phaseStats(rallies);
    return el("tr", { class: rowClass },
      el("th", { class: "name" }, labelText),
      el("td", {}, score),
      el("td", {}, `${phase.sideOut.won}/${phase.sideOut.n}`),
      el("td", { class: "total" }, pct(ratio(phase.sideOut.won, phase.sideOut.n))),
      el("td", {}, `${phase.break.won}/${phase.break.n}`),
      el("td", { class: "total" }, pct(ratio(phase.break.won, phase.break.n))),
    );
  };
  const rows = numbers.map((n) => {
    const set = ctx.state.sets[n - 1];
    return line(tf("report.setN", { n }), filterSet(ctx.allRallies, n), set ? `${set.score.own}:${set.score.opp}` : "");
  });
  return section(t("report.phaseTitle"), t("report.phaseHint"),
    el("table", { class: "report-table narrow" },
      el("thead", {}, el("tr", {},
        el("th", { class: "name" }, t("report.set")),
        el("th", {}, t("report.score")),
        el("th", { colSpan: 2 }, t("report.sideOut")),
        el("th", { colSpan: 2 }, t("report.break")),
      )),
      el("tbody", {}, rows),
      el("tfoot", {}, line(t("report.total"), ctx.allRallies, `${ctx.state.setsWon.own}:${ctx.state.setsWon.opp}`, "total-row")),
    ),
  );
}

/* ---------- B1. Annahme → Ballwechsel ---------- */

function receptionSection(ctx) {
  const chain = receptionChain(ctx.rallies);
  if (!chain.total.n) return null;
  const line = (head, c) => el("tr", {},
    head,
    el("td", {}, String(c.n)),
    el("td", {}, pct(ratio(c.n, chain.total.n))),
    el("td", {}, pct(ratio(c.attacks, c.n))),
    el("td", {}, pct(ratio(c.kills, c.n))),
    el("td", { class: "total" }, pct(ratio(c.won, c.n))),
  );
  const rows = codesFor("reception")
    .filter((code) => chain.byCode[code].n > 0)
    .map((code) => line(qualityRowHead("reception", code), chain.byCode[code]));
  return section(t("report.receptionTitle"), t("report.receptionHint"),
    el("table", { class: "report-table narrow" },
      el("thead", {}, el("tr", {},
        el("th", { class: "name" }, t("report.receptionQuality")),
        el("th", {}, t("report.count")),
        el("th", {}, t("report.share")),
        el("th", {}, t("report.withAttack")),
        el("th", {}, t("report.firstAttackKill")),
        el("th", {}, t("report.sideOut")),
      )),
      el("tbody", {}, rows),
      el("tfoot", {}, line(el("th", { class: "name" }, t("report.total")), chain.total)),
    ),
  );
}

/*
  Zeilenkopf "++ Doppelt positiv" für eine Stufe einer Aktion (wie im Kreismenü).
  neutral: ohne Farbe (bei Berührungen des Gegners wäre Grün für uns schlecht)
*/
function qualityRowHead(action, code, neutral = false) {
  const color = neutral ? "var(--border)" : (qualityDisplay(code, action)?.color ?? "transparent");
  return el("th", { class: "name quality-row", style: `border-left-color: ${color}` }, qualityText(code, action));
}

/* ---------- B2. Zuspiel nach Vorlage ---------- */

function setSection(ctx) {
  const chain = setChain(ctx.rallies);
  const totalSets = chain.matrix.flat().reduce((a, b) => a + b, 0);
  if (!totalSets && !chain.noInput) return null;
  const setCodes = codesFor("set");

  // Matrix: Zeilen = Rang der Vorlage, Spalten = Stufe des Zuspiels
  const matrixRows = chain.matrix.map((row, rank) => {
    const n = row.reduce((a, b) => a + b, 0);
    if (!n) return null;
    return el("tr", {},
      el("th", { class: "name quality-row", style: `border-left-color: ${rankColor(rank)}` },
        t(`report.rank.${rank}`)),
      row.map((c) => el("td", {}, count(c))),
      el("td", {}, String(n)),
      el("td", { class: "total" }, pct(ratio(row[0] + row[1], n))),
    );
  });

  const matrix = el("table", { class: "report-table narrow" },
    el("thead", {}, el("tr", {},
      el("th", { class: "name" }, t("report.inputQuality")),
      setCodes.map((code) => codeHeader("set", code)),
      el("th", {}, t("report.sum")),
      el("th", {}, t("report.goodSet")),
    )),
    el("tbody", {}, matrixRows),
  );

  // Pro Zuspieler: Anteil guter Zuspiele je Vorlagen-Gruppe
  const bucketCells = (row) => BUCKETS.map((b) => [
    el("td", {}, String(row[b].n)),
    el("td", { class: "total" }, pct(ratio(row[b].good, row[b].n))),
  ]);
  const setterRows = [...chain.setters.entries()]
    .sort(([a], [b]) => (ctx.playerById.get(a)?.number ?? 0) - (ctx.playerById.get(b)?.number ?? 0))
    .map(([id, row]) => el("tr", {}, el("th", { class: "name" }, ctx.label(id)), bucketCells(row)));
  const setters = el("table", { class: "report-table narrow" },
    el("thead", {},
      el("tr", {},
        el("th", { rowSpan: 2, class: "name" }, t("report.setter")),
        BUCKETS.map((b) => el("th", { colSpan: 2, class: "group" }, t(`report.bucket.${b}`))),
      ),
      el("tr", {}, BUCKETS.map(() => [el("th", {}, t("report.count")), el("th", {}, t("report.goodSet"))])),
    ),
    el("tbody", {}, setterRows),
    el("tfoot", {}, el("tr", { class: "total-row" }, el("th", { class: "name" }, t("report.total")), bucketCells(chain.totals))),
  );

  return section(t("report.setTitle"), t("report.setHint"),
    el("div", { class: "report-pair" }, matrix, setters),
    chain.noInput > 0 && el("p", { class: "report-hint" }, tf("report.noInputSets", { n: chain.noInput })),
  );
}

/* ---------- B3. Angriff nach Vorlage ---------- */

function attackSection(ctx) {
  const chain = attackChain(ctx.rallies);
  const total = INPUT_GROUPS.reduce((sum, g) => sum + chain.totals[g].n, 0);
  if (!total) return null;
  const groups = INPUT_GROUPS.filter((g) => g !== "none" || chain.totals.none.n > 0);

  const groupCells = (row) => groups.map((g) => [
    el("td", {}, String(row[g].n)),
    el("td", {}, pct(ratio(row[g].kills, row[g].n))),
    el("td", { class: "total" }, pct(ratio(row[g].kills - row[g].errors, row[g].n))),
  ]);
  const rows = [...chain.attackers.entries()]
    .sort(([a], [b]) => (ctx.playerById.get(a)?.number ?? 0) - (ctx.playerById.get(b)?.number ?? 0))
    .map(([id, row]) => el("tr", {}, el("th", { class: "name" }, ctx.label(id)), groupCells(row)));

  return section(t("report.attackTitle"), t("report.attackHint"),
    el("div", { class: "table-wrap" }, el("table", { class: "report-table" },
      el("thead", {},
        el("tr", {},
          el("th", { rowSpan: 2, class: "name" }, t("report.attacker")),
          groups.map((g) => el("th", { colSpan: 3, class: "group" }, t(`report.bucket.${g}`))),
        ),
        el("tr", {}, groups.map(() => [
          el("th", {}, t("report.count")), el("th", {}, t("report.killRate")), el("th", {}, t("report.efficiency")),
        ])),
      ),
      el("tbody", {}, rows),
      el("tfoot", {}, el("tr", { class: "total-row" }, el("th", { class: "name" }, t("report.total")), groupCells(chain.totals))),
    )),
  );
}

/* ---------- B4. Aufschlag → gegnerische Annahme → Break ---------- */

function serveSection(ctx) {
  const chain = serveChain(ctx.rallies);
  const total = SERVE_GROUPS.reduce((sum, g) => sum + chain.outcomes[g].n, 0);
  if (!total) return null;

  const groupHead = (g) => {
    if (g === "ace") return el("th", { class: "name quality-row", style: `border-left-color: ${rankColor(0)}` }, t("report.serveGroup.ace"));
    if (g === "error") return el("th", { class: "name quality-row", style: `border-left-color: ${rankColor(5)}` }, t("report.serveGroup.error"));
    if (g === "unrecorded") return el("th", { class: "name" }, t("report.serveGroup.unrecorded"));
    return qualityRowHead("reception", g, true); // Annahme des GEGNERS: ohne Farbe
  };
  const outcomeRows = SERVE_GROUPS.filter((g) => chain.outcomes[g].n > 0).map((g) => {
    const o = chain.outcomes[g];
    return el("tr", {},
      groupHead(g),
      el("td", {}, String(o.n)),
      el("td", {}, pct(ratio(o.n, total))),
      el("td", { class: "total" }, pct(ratio(o.won, o.n))),
    );
  });
  const won = SERVE_GROUPS.reduce((sum, g) => sum + chain.outcomes[g].won, 0);
  const outcomes = el("table", { class: "report-table narrow" },
    el("thead", {}, el("tr", {},
      el("th", { class: "name" }, t("report.oppReception")),
      el("th", {}, t("report.count")),
      el("th", {}, t("report.share")),
      el("th", {}, t("report.break")),
    )),
    el("tbody", {}, outcomeRows),
    el("tfoot", {}, el("tr", { class: "total-row" },
      el("th", { class: "name" }, t("report.total")),
      el("td", {}, String(total)), el("td", {}), el("td", { class: "total" }, pct(ratio(won, total))),
    )),
  );

  const serverRows = [...chain.servers.entries()]
    .sort(([a], [b]) => (ctx.playerById.get(a)?.number ?? 0) - (ctx.playerById.get(b)?.number ?? 0))
    .map(([id, s]) => el("tr", {},
      el("th", { class: "name" }, ctx.label(id)),
      el("td", {}, String(s.n)),
      el("td", {}, count(s.aces)),
      el("td", {}, count(s.errors)),
      el("td", {}, pct(ratio(s.poorReception, s.n))),
      el("td", { class: "total" }, pct(ratio(s.won, s.n))),
    ));
  const servers = el("table", { class: "report-table narrow" },
    el("thead", {}, el("tr", {},
      el("th", { class: "name" }, t("report.server")),
      el("th", {}, t("report.count")),
      el("th", {}, t("report.aces")),
      el("th", {}, t("report.faults")),
      el("th", {}, t("report.poorReception")),
      el("th", {}, t("report.break")),
    )),
    el("tbody", {}, serverRows),
  );

  return section(t("report.serveTitle"), t("report.serveHint"),
    el("div", { class: "report-pair" }, outcomes, servers));
}
