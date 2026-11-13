/*
  radial-menu.js – das Kreismenü ("Waffenrad").

  Benutzung (siehe match-live.js):
    const menu = createRadialMenu({ getActionLabel, getItems, onCenterTap, onSelect });
    menu.start(pointerEvent, player);   // beim Antippen eines Spielers aufrufen
  getItems() liefert die Stücke der aktuellen Aktion, vom besten zum schlechtesten:
    [{ label: "++", color: "var(--q-plus2)", name: "Doppelt positiv" }, …]
  (meist 6, beim Block 5). Beim Ziehen zeigt die Mitte den Namen des markierten Stücks.

  Ablauf:
    1. Finger setzt auf einem Spieler auf -> Rad erscheint um den Finger.
    2a. Finger wird in eine Richtung gezogen und losgelassen -> Stufe gewählt.
    2b. Finger wird ohne Bewegung losgelassen -> Rad bleibt offen,
        nächster Tipp: Segment = auswählen, Mitte = Aktion wechseln, außerhalb = abbrechen.
    2c. Bricht das System die Berührung ab (pointercancel), bleibt das Rad
        ebenfalls offen wie bei 2b – es verschwindet nie "von selbst".

  Am Bildschirmrand (Nutzerwunsch 13.11.2026): Die Mitte bleibt unter dem
  Finger. Passt der ganze Kreis nicht hin, werden die 6 Stufen als FÄCHER
  nur auf der freien Seite verteilt (am Rand Halbkreis, in der Ecke etwa
  Viertelkreis), mit größerem Radius. Die Rechnung steckt in menuLayout()
  und segmentAt() (rein, getestet in tests/radial.test.mjs).
*/
// ---------- Maße in Pixeln (hier anpassen, wenn das Rad zu groß/klein ist) ----------
const RADIUS = 120;     // Außenradius des vollen Rads
const FAN_RADIUS = 150; // Außenradius des Fächers am Rand (größer, weil die Stücke schmaler sind)
const INNER = 42;       // Radius der Mitte
const DEADZONE = 30;    // Mindestabstand vom Mittelpunkt, ab dem ein Segment zählt
const MARGIN = 8;       // Abstand des Rads zum Bildschirmrand
const MIN_ARC = 100;    // kleinster Fächer in Grad; ist weniger Platz, wird der Kreis verschoben (Notlösung)
const TOLERANCE = 20;   // so viele Grad neben dem Fächer zählen noch als erstes/letztes Stück

const SVG_NS = "http://www.w3.org/2000/svg"; // nötig, um SVG-Elemente per JavaScript zu erzeugen

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
// Winkel auf 0–360° bringen (wie value % 360 in Python, auch für negative Werte)
const norm = (angle) => ((angle % 360) + 360) % 360;
// Abstand eines Winkels zu "oben" (0°), 0–180°
const fromTop = (angle) => Math.min(norm(angle), 360 - norm(angle));

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
  Größter zusammenhängender Bogen (in Grad), in dem der Außenrand eines Rads
  mit diesem Radius um (x, y) noch auf den Bildschirm (w × h) passt.
  Geprüft wird in 1°-Schritten. Ergebnis: { start, width } (im Uhrzeigersinn ab start).
*/
function freeArc(x, y, w, h, radius) {
  const fits = [];
  for (let a = 0; a < 360; a++) {
    const p = pointAt(a, radius);
    fits.push(x + p.x >= MARGIN && x + p.x <= w - MARGIN && y + p.y >= MARGIN && y + p.y <= h - MARGIN);
  }
  if (fits.every(Boolean)) return { start: 0, width: 360 };
  // Einmal rundherum laufen, beginnend bei einer Richtung, die NICHT passt
  // (so wird ein Bogen über 0° hinweg nicht in zwei Teile zerschnitten).
  const first = fits.indexOf(false);
  let best = { start: 0, width: 0 };
  let runStart = 0, run = 0;
  for (let k = 1; k <= 360; k++) {
    const a = (first + k) % 360;
    if (!fits[a]) { run = 0; continue; }
    if (run === 0) runStart = a;
    run += 1;
    if (run > best.width) best = { start: runStart, width: run };
  }
  return best;
}

/*
  Wo und wie wird das Rad gezeichnet, wenn der Finger bei (x, y) aufsetzt?
  Ergebnis: { cx, cy, radius, start, width, reverse, count }
    cx, cy   Mittelpunkt (= Finger; nur ganz am Rand ein kleines Stück nach innen)
    start, width   Bogen in Grad, auf den die Stufen verteilt werden (360 = voller Kreis)
    reverse  true: Stufe 0 liegt am Ende des Bogens (damit die beste möglichst oben ist)
    count    Anzahl der Stücke (meist 6, beim Block 5)
  Exportiert für die Tests.
*/
export function menuLayout(x, y, w, h, count = 6) {
  // Die Mitte selbst muss ganz sichtbar sein
  const inset = INNER + MARGIN;
  const cx = clamp(x, inset, w - inset);
  const cy = clamp(y, inset, h - inset);
  const full = { radius: RADIUS, start: -180 / count, width: 360, reverse: false, count };

  const fitsFull = cx - RADIUS >= MARGIN && cx + RADIUS <= w - MARGIN
    && cy - RADIUS >= MARGIN && cy + RADIUS <= h - MARGIN;
  if (fitsFull) return { cx, cy, ...full };

  const arc = freeArc(cx, cy, w, h, FAN_RADIUS);
  if (arc.width >= MIN_ARC) {
    // Ende näher an "oben" als der Anfang? Dann von hinten anfangen.
    const reverse = fromTop(arc.start + arc.width) < fromTop(arc.start);
    return { cx, cy, radius: FAN_RADIUS, start: arc.start, width: arc.width, reverse, count };
  }

  // Notlösung (sehr kleiner Bildschirm): voller Kreis, so weit verschoben, dass er passt
  return {
    cx: clamp(x, RADIUS + MARGIN, w - RADIUS - MARGIN),
    cy: clamp(y, RADIUS + MARGIN, h - RADIUS - MARGIN),
    ...full,
  };
}

// Anfangs- und Endwinkel des Stücks Nr. index (0 = beste Stufe) in diesem Layout
function segmentRange(index, layout) {
  const step = layout.width / layout.count;
  const slot = layout.reverse ? layout.count - 1 - index : index;
  const a0 = layout.start + slot * step;
  return [a0, a0 + step];
}

/*
  Welches Stück liegt in Richtung (dx, dy) vom Mittelpunkt?
  Gibt 0 … count-1 zurück, oder null, wenn die Richtung deutlich neben dem Fächer liegt.
  Exportiert für die Tests.
*/
export function segmentAt(dx, dy, layout) {
  const last = layout.count - 1;
  // atan2 liefert den Winkel; so umgestellt, dass 0° oben ist
  const angle = norm((Math.atan2(dx, -dy) * 180) / Math.PI);
  const rel = norm(angle - layout.start); // Winkel ab Beginn des Bogens
  const step = layout.width / layout.count;
  let slot;
  if (rel < layout.width) {
    slot = Math.floor(rel / step);
  } else {
    // neben dem Fächer: knapp daneben zählt noch als erstes bzw. letztes Stück
    const afterEnd = rel - layout.width;
    const beforeStart = 360 - rel;
    if (Math.min(afterEnd, beforeStart) > TOLERANCE) return null;
    slot = afterEnd < beforeStart ? last : 0;
  }
  slot = clamp(slot, 0, last);
  return layout.reverse ? last - slot : slot;
}

// Zeichnet ein tortenstück-förmiges Segment als SVG-Pfad.
function segmentPath(index, layout) {
  const [a0, a1] = segmentRange(index, layout);
  const r = layout.radius;
  const o0 = pointAt(a0, r), o1 = pointAt(a1, r);
  const i0 = pointAt(a0, INNER), i1 = pointAt(a1, INNER);
  // M = gehe zu, A = Bogen, L = Linie, Z = schließen
  return `M ${o0.x} ${o0.y} A ${r} ${r} 0 0 1 ${o1.x} ${o1.y}
          L ${i1.x} ${i1.y} A ${INNER} ${INNER} 0 0 0 ${i0.x} ${i0.y} Z`;
}

/*
  Schreibt Text in ein SVG-<text>; bei Leerzeichen zweizeilig ("Freeball" / "rüber").
  (SVG bricht nicht von selbst um, deshalb zwei <tspan>-Zeilen.)
*/
function setLines(textEl, value) {
  textEl.replaceChildren();
  const words = String(value).split(" ");
  const lines = words.length > 1 ? [words[0], words.slice(1).join(" ")] : words;
  lines.forEach((line, i) => {
    const span = document.createElementNS(SVG_NS, "tspan");
    span.setAttribute("x", textEl.getAttribute("x") ?? 0);
    // erste Zeile etwas nach oben, damit beide Zeilen zusammen mittig stehen
    span.setAttribute("dy", i === 0 ? `${-(lines.length - 1) * 0.55}em` : "1.1em");
    span.textContent = line;
    textEl.appendChild(span);
  });
}

export function createRadialMenu({ getActionLabel, getItems, onCenterTap, onSelect }) {
  // ---------- Aufbau der Elemente (einmalig) ----------

  // Overlay = durchsichtige Fläche über dem ganzen Bildschirm, darauf liegt das Rad
  const overlay = document.createElement("div");
  overlay.className = "radial-overlay";
  overlay.hidden = true;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "radial-menu");
  // Zeichenfläche groß genug für den Fächer; der Mittelpunkt ist (0, 0)
  const SIZE = FAN_RADIUS * 2;
  svg.setAttribute("width", SIZE);
  svg.setAttribute("height", SIZE);
  svg.setAttribute("viewBox", `${-FAN_RADIUS} ${-FAN_RADIUS} ${SIZE} ${SIZE}`);

  // Gruppe für die Stücke; wird bei jedem Öffnen bzw. Aktionswechsel neu gefüllt
  const pieces = document.createElementNS(SVG_NS, "g");
  svg.appendChild(pieces);
  let segments = [];

  // Stücke mit Beschriftung passend zu Aktion (items) und Layout (Kreis oder Fächer)
  function drawLayout() {
    pieces.replaceChildren();
    segments = items.map((item, index) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", "radial-segment");
      path.setAttribute("d", segmentPath(index, layout));
      path.style.fill = item.color;
      pieces.appendChild(path);

      const [a0, a1] = segmentRange(index, layout);
      const pos = pointAt((a0 + a1) / 2, (layout.radius + INNER) / 2);
      const label = document.createElementNS(SVG_NS, "text");
      // Wörter kleiner als Zeichen wie "++", damit sie ins Stück passen
      label.setAttribute("class", `radial-label${item.label.length > 2 ? " word" : ""}`);
      label.setAttribute("x", pos.x);
      label.setAttribute("y", pos.y);
      setLines(label, item.label);
      pieces.appendChild(label);
      return path;
    });
  }

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
  let layout = null;        // aktuelles Layout (menuLayout): voller Kreis oder Fächer
  let items = [];           // Stücke der aktuellen Aktion (getItems)
  let fingerX = 0, fingerY = 0; // wo der Finger aufgesetzt hat (für Neuberechnung beim Aktionswechsel)
  let highlighted = null;   // aktuell markiertes Segment oder null
  let pointerId = null;     // der Finger, der das Rad geöffnet hat (andere Finger zählen nicht)

  // Markiertes Stück hervorheben; die Mitte zeigt dann seinen vollen Namen
  function highlight(index) {
    highlighted = index;
    segments.forEach((path, i) => path.classList.toggle("active", i === index));
    updateCenterText();
  }

  function close() {
    state = "closed";
    overlay.hidden = true;
    highlight(null);
    player = null;
    pointerId = null;
  }

  function select(index) {
    const chosenPlayer = player;
    close();
    navigator.vibrate?.(15); // kurzes Vibrieren, falls das Gerät es kann ("?." = nur wenn vorhanden)
    // index = Stück (0 = bestes); welcher Code das ist, weiß der Aufrufer (ratings.js menuCodes)
    onSelect({ player: chosenPlayer, index });
  }

  // Mitte: Name des markierten Stücks, sonst die Aktion
  function updateCenterText() {
    const item = highlighted !== null ? items[highlighted] : null;
    centerText.classList.toggle("name", Boolean(item));
    setLines(centerText, item ? item.name : getActionLabel());
  }

  // Stücke der aktuellen Aktion holen und Layout dafür berechnen
  function prepare() {
    items = getItems();
    layout = menuLayout(fingerX, fingerY, window.innerWidth, window.innerHeight, items.length);
    ({ cx, cy } = layout);
    drawLayout();
  }

  // ---------- Öffnen ----------
  function start(event, tappedPlayer) {
    player = tappedPlayer;
    // Mittelpunkt = Fingerposition; am Rand Fächer statt verschobenem Kreis
    fingerX = event.clientX;
    fingerY = event.clientY;
    prepare();
    svg.style.left = `${cx - FAN_RADIUS}px`;
    svg.style.top = `${cy - FAN_RADIUS}px`;
    updateCenterText();
    highlight(null);
    overlay.hidden = false;
    state = "dragging";
    pointerId = event.pointerId;
    /*
      "Pointer capture": Alle weiteren Bewegungen dieses Fingers gehen an das
      Overlay, nicht mehr an den Spielerknopf. Wird der Bildschirm darunter
      neu gezeichnet (z. B. weil die vorige Eingabe gerade gespeichert wurde),
      verliert das Rad den Finger dadurch nicht.
    */
    try {
      overlay.setPointerCapture(event.pointerId);
    } catch {
      // ältere Browser oder synthetische Ereignisse: dann ohne Capture
    }
  }

  // Gehört dieses Ereignis zum Finger, der das Rad geöffnet hat?
  // (Ein zweiter Finger, z. B. der Daumen am Rand, soll nichts auslösen.)
  function isOwnPointer(event) {
    return pointerId === null || event.pointerId === pointerId;
  }

  // ---------- Finger bewegt sich (nur beim Ziehen) ----------
  window.addEventListener("pointermove", (event) => {
    if (state !== "dragging" || !isOwnPointer(event)) return;
    const dx = event.clientX - cx, dy = event.clientY - cy;
    const distance = Math.hypot(dx, dy); // Abstand zum Mittelpunkt (Pythagoras)
    highlight(distance > DEADZONE ? segmentAt(dx, dy, layout) : null);
  });

  // ---------- Finger hoch ----------
  window.addEventListener("pointerup", (event) => {
    if (state !== "dragging" || !isOwnPointer(event)) return;
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

  /*
    Abbruch durch das System (z. B. Scrollgeste, langes Drücken, Anruf):
    Das Rad bleibt offen und wartet auf einen Tipp, statt zu verschwinden.
    Abbrechen geht dann mit einem Tipp außerhalb.
  */
  window.addEventListener("pointercancel", (event) => {
    if (state !== "dragging" || !isOwnPointer(event)) return;
    highlight(null);
    state = "open";
  });

  // ---------- Tipp, während das Rad offen ist ----------
  overlay.addEventListener("pointerdown", (event) => {
    if (state !== "open") return;
    const dx = event.clientX - cx, dy = event.clientY - cy;
    const distance = Math.hypot(dx, dy);

    const index = segmentAt(dx, dy, layout);
    if (distance < INNER) {
      onCenterTap();          // Mitte -> Aktion wechseln
      prepare();              // andere Aktion = andere Beschriftungen (Block: 5 Stücke)
      highlight(null);
    } else if (distance <= layout.radius + 20 && index !== null) {
      select(index);          // Segment (mit etwas Spielraum am Rand)
    } else {
      close();                // außerhalb (auch neben dem Fächer) -> abbrechen
    }
  });

  return { start, close };
}
