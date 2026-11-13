/*
  radial-menu.js – das Kreismenü ("Waffenrad").

  Benutzung (siehe radial-test.js):
    const menu = createRadialMenu({ getActionLabel, onCenterTap, onSelect });
    menu.start(pointerEvent, player);   // beim Antippen eines Spielers aufrufen

  Ablauf:
    1. Finger setzt auf einem Spieler auf -> Rad erscheint um den Finger.
    2a. Finger wird in eine Richtung gezogen und losgelassen -> Stufe gewählt.
    2b. Finger wird ohne Bewegung losgelassen -> Rad bleibt offen,
        nächster Tipp: Segment = auswählen, Mitte = Aktion wechseln, außerhalb = abbrechen.
*/
import { QUALITIES } from "./ratings.js";

// ---------- Maße in Pixeln (hier anpassen, wenn das Rad zu groß/klein ist) ----------
const RADIUS = 120;     // Außenradius des Rads
const INNER = 42;       // Radius der Mitte
const DEADZONE = 30;    // Mindestabstand vom Mittelpunkt, ab dem ein Segment zählt
const MARGIN = 8;       // Abstand des Rads zum Bildschirmrand

const SEGMENT_ANGLE = 360 / QUALITIES.length; // 6 Stufen -> 60° pro Segment
const SVG_NS = "http://www.w3.org/2000/svg"; // nötig, um SVG-Elemente per JavaScript zu erzeugen

/*
  Rechnet Winkel + Abstand in einen Punkt um.
  Winkel 0° zeigt nach oben, positive Winkel laufen im Uhrzeigersinn.
  (Math.sin/cos erwarten Bogenmaß, deshalb * Math.PI / 180.)
*/
function pointAt(angleDeg, distance) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: distance * Math.sin(rad), y: -distance * Math.cos(rad) };
}

/*
  Welches Segment liegt in Richtung (dx, dy) vom Mittelpunkt?
  Gibt die Nummer 0–5 zurück. Segment 0 liegt oben, dann im Uhrzeigersinn.
  Exportiert, damit man die Rechnung auch einzeln testen kann.
*/
export function segmentFromOffset(dx, dy) {
  // atan2 liefert den Winkel; so umgestellt, dass 0° oben ist
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  angle = (angle + 360) % 360; // negative Winkel in 0–360° umwandeln
  // + halbes Segment, damit Segment 0 von -30° bis +30° reicht
  return Math.floor(((angle + SEGMENT_ANGLE / 2) % 360) / SEGMENT_ANGLE);
}

// Zeichnet ein tortenstück-förmiges Segment als SVG-Pfad.
function segmentPath(index) {
  const a0 = index * SEGMENT_ANGLE - SEGMENT_ANGLE / 2;
  const a1 = a0 + SEGMENT_ANGLE;
  const o0 = pointAt(a0, RADIUS), o1 = pointAt(a1, RADIUS);
  const i0 = pointAt(a0, INNER), i1 = pointAt(a1, INNER);
  // M = gehe zu, A = Bogen, L = Linie, Z = schließen
  return `M ${o0.x} ${o0.y} A ${RADIUS} ${RADIUS} 0 0 1 ${o1.x} ${o1.y}
          L ${i1.x} ${i1.y} A ${INNER} ${INNER} 0 0 0 ${i0.x} ${i0.y} Z`;
}

export function createRadialMenu({ getActionLabel, onCenterTap, onSelect }) {
  // ---------- Aufbau der Elemente (einmalig) ----------

  // Overlay = durchsichtige Fläche über dem ganzen Bildschirm, darauf liegt das Rad
  const overlay = document.createElement("div");
  overlay.className = "radial-overlay";
  overlay.hidden = true;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "radial-menu");
  svg.setAttribute("width", RADIUS * 2);
  svg.setAttribute("height", RADIUS * 2);
  svg.setAttribute("viewBox", `${-RADIUS} ${-RADIUS} ${RADIUS * 2} ${RADIUS * 2}`);

  // Die 6 Segmente mit Symbol
  const segments = QUALITIES.map((quality, index) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", segmentPath(index));
    path.setAttribute("class", "radial-segment");
    path.style.fill = quality.color;
    svg.appendChild(path);

    const labelPos = pointAt(index * SEGMENT_ANGLE, (RADIUS + INNER) / 2);
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", labelPos.x);
    label.setAttribute("y", labelPos.y);
    label.setAttribute("class", "radial-label");
    label.textContent = quality.symbol;
    svg.appendChild(label);

    return path;
  });

  // Die Mitte mit dem Namen der Aktion
  const center = document.createElementNS(SVG_NS, "circle");
  center.setAttribute("r", INNER - 4);
  center.setAttribute("class", "radial-center");
  svg.appendChild(center);

  const centerText = document.createElementNS(SVG_NS, "text");
  centerText.setAttribute("class", "radial-center-text");
  svg.appendChild(centerText);

  overlay.appendChild(svg);
  document.body.appendChild(overlay);

  // ---------- Zustand ----------
  // state: "closed" | "dragging" (Finger noch unten) | "open" (wartet auf Tipp)
  let state = "closed";
  let player = null;        // der angetippte Spieler
  let cx = 0, cy = 0;       // Mittelpunkt des Rads auf dem Bildschirm
  let highlighted = null;   // aktuell markiertes Segment (0–5) oder null

  function highlight(index) {
    highlighted = index;
    segments.forEach((path, i) => path.classList.toggle("active", i === index));
  }

  function close() {
    state = "closed";
    overlay.hidden = true;
    highlight(null);
    player = null;
  }

  function select(index) {
    const chosenPlayer = player;
    close();
    navigator.vibrate?.(15); // kurzes Vibrieren, falls das Gerät es kann ("?." = nur wenn vorhanden)
    // index = Segment 0–5 (0 = bestes); welcher Code das ist, hängt von der Aktion ab (ratings.js codesFor)
    onSelect({ player: chosenPlayer, quality: QUALITIES[index], index });
  }

  function updateCenterText() {
    centerText.textContent = getActionLabel();
  }

  // ---------- Öffnen ----------
  function start(event, tappedPlayer) {
    player = tappedPlayer;
    // Mittelpunkt = Fingerposition, aber so verschoben, dass das Rad ganz sichtbar ist
    cx = Math.min(Math.max(event.clientX, RADIUS + MARGIN), window.innerWidth - RADIUS - MARGIN);
    cy = Math.min(Math.max(event.clientY, RADIUS + MARGIN), window.innerHeight - RADIUS - MARGIN);
    svg.style.left = `${cx - RADIUS}px`;
    svg.style.top = `${cy - RADIUS}px`;
    updateCenterText();
    highlight(null);
    overlay.hidden = false;
    state = "dragging";
  }

  // ---------- Finger bewegt sich (nur beim Ziehen) ----------
  window.addEventListener("pointermove", (event) => {
    if (state !== "dragging") return;
    const dx = event.clientX - cx, dy = event.clientY - cy;
    const distance = Math.hypot(dx, dy); // Abstand zum Mittelpunkt (Pythagoras)
    highlight(distance > DEADZONE ? segmentFromOffset(dx, dy) : null);
  });

  // ---------- Finger hoch ----------
  window.addEventListener("pointerup", () => {
    if (state !== "dragging") return;
    if (highlighted !== null) {
      select(highlighted);   // gezogen -> auswählen
    } else {
      state = "open";        // nur getippt -> Rad bleibt offen
    }
  });

  /*
    Langes Drücken: Am Handy öffnet der Browser sonst nach ca. 0,5 s sein
    Kontextmenü und bricht die Berührung ab ("pointercancel") – das Rad wäre
    sofort wieder weg. Solange das Rad offen ist, wird das Kontextmenü deshalb
    überall unterdrückt (nicht nur auf einem bestimmten Spielfeld).
  */
  window.addEventListener("contextmenu", (event) => {
    if (state !== "closed") event.preventDefault();
  });

  // Abbruch durch das System (z. B. eingehender Anruf)
  window.addEventListener("pointercancel", () => {
    if (state === "dragging") close();
  });

  // ---------- Tipp, während das Rad offen ist ----------
  overlay.addEventListener("pointerdown", (event) => {
    if (state !== "open") return;
    const dx = event.clientX - cx, dy = event.clientY - cy;
    const distance = Math.hypot(dx, dy);

    if (distance < INNER) {
      onCenterTap();          // Mitte -> Aktion wechseln
      updateCenterText();
    } else if (distance <= RADIUS + 20) {
      select(segmentFromOffset(dx, dy)); // Segment (mit etwas Spielraum am Rand)
    } else {
      close();                // außerhalb -> abbrechen
    }
  });

  return { start, close };
}
