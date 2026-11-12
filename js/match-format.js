/*
  match-format.js – Spieldaten als lesbaren Text darstellen
  (Datum, Ergebnis, Spieler, Ereignisse). Wird von mehreren Bildschirmen benutzt.
*/
import { t, tf, getLanguage } from "./i18n.js";

// "2026-11-12T19:30" -> "12.11.2026, 19:30" (bzw. englisches Format)
export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(getLanguage(), { dateStyle: "medium", timeStyle: "short" });
}

// Ergebnis aus computeMatch(), z. B. "2:1 (25:20, 18:25, 25:23)". Noch kein Satz: "–".
export function matchResultText(state) {
  if (!state.sets.length) return "–";
  const sets = state.sets.map((s) => `${s.score.own}:${s.score.opp}`).join(", ");
  return `${state.setsWon.own}:${state.setsWon.opp} (${sets})`;
}

// Spieler als "#7 Anna" (Name kann bei Gegnern fehlen).
export function playerLabel(player) {
  if (!player) return "?";
  return player.name ? `#${player.number} ${player.name}` : `#${player.number}`;
}

/*
  Ein Ereignis als Satz, z. B. "Wechsel Wir: #7 Anna für #12 Ben".
  names = { own: "Teamname", opp: "Gegnername" }, playerById = Map id -> Spieler
*/
export function eventText(event, names, playerById) {
  const p = (id) => playerLabel(playerById.get(id));
  switch (event.type) {
    case "setStart":
      return tf("event.setStart", { n: event.setNumber, team: names[event.firstServe] });
    case "point":
      return tf("event.point", { team: names[event.winner] });
    case "substitution":
      return tf(event.exceptional ? "event.substitutionExceptional" : "event.substitution",
        { team: names[event.team], in: p(event.inId), out: p(event.outId) });
    case "liberoSwap":
      return tf("event.liberoSwap", { team: names[event.team], in: p(event.inId), out: p(event.outId) });
    default:
      return event.type;
  }
}
