/*
  match-format.js – Spieldaten als lesbaren Text darstellen
  (Datum, Ergebnis, Spieler, Ereignisse). Wird von mehreren Bildschirmen benutzt.
*/
import { t, tf, getLanguage } from "./i18n.js";
import { qualityDisplay } from "./ratings.js";
import { BAND_NAMES, OUT } from "./zones.js";

// Zone als Text: "AUS", "Zone 4", "Zone C4", "grüne Zone"
export function zoneText(zone) {
  if (!zone) return "";
  if (zone === OUT) return t("zone.out");
  if (zone.startsWith("P")) return t(`zone.band.${BAND_NAMES[zone.slice(1)]}`);
  return tf("zone.named", { zone });
}

/*
  Eine Ballberührung als Text, z. B. "#7 Anna: Annahme + Positiv · Zone B3".
  Der Name der Stufe kommt aus der Bewertungsgrundlage und hängt von der Aktion ab
  ("quality.<aktion>.<id>"). Ohne Spieler (playerId null) steht der Name der Mannschaft da.
*/
export function touchText(touch, names, playerById) {
  const quality = qualityDisplay(touch.quality, touch.action);
  const text = tf("event.touch", {
    who: touch.playerId ? playerLabel(playerById.get(touch.playerId)) : names[touch.team],
    action: t(`action.${touch.action}`),
    quality: quality ? `${quality.symbol} ${t(`quality.${touch.action}.${quality.id}`)}` : touch.quality,
  });
  return touch.zone ? `${text} · ${zoneText(touch.zone)}` : text;
}

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

// Verursacher eines Punktes: Spieler oder "Trainer" (id "coach", siehe rules.js COACH)
export function causeLabel(id, playerById) {
  return id === "coach" ? t("point.coach") : playerLabel(playerById.get(id));
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
    case "point": {
      // Grund nur bei manuellen Punkten (ältere Punkte und "touch" ohne Zusatz)
      const base = tf("event.point", { team: names[event.winner] });
      if (!event.reason || event.reason === "touch") return base;
      const reason = t(`point.reason.${event.reason}`);
      return event.causeId
        ? `${base} – ${reason}: ${causeLabel(event.causeId, playerById)}`
        : `${base} – ${reason}`;
    }
    case "timeout":
      return tf("event.timeout", { team: names[event.team] });
    case "substitution":
      return tf(event.exceptional ? "event.substitutionExceptional" : "event.substitution",
        { team: names[event.team], in: p(event.inId), out: p(event.outId) });
    case "liberoSwap":
      return tf("event.liberoSwap", { team: names[event.team], in: p(event.inId), out: p(event.outId) });
    case "touch":
      return touchText(event, names, playerById);
    default:
      return event.type;
  }
}
