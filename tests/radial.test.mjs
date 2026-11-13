/*
  Tests für die Rechnung des Kreismenüs (radial-menu.js): voller Kreis in der
  Mitte, Fächer am Rand und in der Ecke, Auswahl des Stücks.
  Ausführen: node --test tests/radial.test.mjs
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { menuLayout, segmentAt } from "../js/radial-menu.js";

// Richtung als Winkel (0° = oben, im Uhrzeigersinn) -> Versatz dx, dy
const dir = (angle, distance = 80) => {
  const rad = (angle * Math.PI) / 180;
  return [distance * Math.sin(rad), -distance * Math.cos(rad)];
};

test("Mitte des Bildschirms: voller Kreis, Mittelpunkt = Finger, Stück 0 oben", () => {
  const layout = menuLayout(400, 400, 800, 800);
  assert.equal(layout.width, 360);
  assert.equal(layout.cx, 400);
  assert.equal(layout.cy, 400);
  assert.equal(segmentAt(...dir(0), layout), 0);    // oben
  assert.equal(segmentAt(...dir(60), layout), 1);   // rechts oben
  assert.equal(segmentAt(...dir(180), layout), 3);  // unten
  assert.equal(segmentAt(...dir(300), layout), 5);  // links oben
  assert.equal(segmentAt(...dir(29), layout), 0);   // knapp neben oben
});

test("linker Rand: Fächer nach rechts, Mittelpunkt bleibt unter dem Finger", () => {
  const layout = menuLayout(70, 300, 400, 600);
  assert.equal(layout.cx, 70);
  assert.equal(layout.cy, 300);
  assert.ok(layout.width < 360 && layout.width >= 100);
  assert.equal(segmentAt(...dir(5), layout), 0);     // ★ oben
  assert.equal(segmentAt(...dir(175), layout), 5);   // schlechteste unten
  assert.equal(segmentAt(...dir(270), layout), null); // nach links (aus dem Bild): nichts
});

test("rechter Rand: Fächer nach links, ★ trotzdem oben", () => {
  const layout = menuLayout(330, 300, 400, 600);
  assert.equal(layout.cx, 330);
  assert.equal(segmentAt(...dir(355), layout), 0);   // oben
  assert.equal(segmentAt(...dir(185), layout), 5);   // unten
  assert.equal(segmentAt(...dir(90), layout), null);  // nach rechts: nichts
});

test("Ecke: Fächer zum Bildschirm hin, alle 6 Stücke erreichbar", () => {
  const layout = menuLayout(60, 60, 400, 600);
  assert.equal(layout.cx, 60);
  assert.equal(layout.cy, 60);
  assert.ok(layout.width >= 100);
  const found = new Set();
  for (let a = 0; a < 360; a += 2) {
    const index = segmentAt(...dir(a), layout);
    if (index !== null) found.add(index);
  }
  assert.equal(found.size, 6);
  assert.equal(segmentAt(...dir(315), layout), null); // Richtung Ecke: nichts
});

test("ganz am Rand: Mittelpunkt rückt nur so weit nach innen, dass die Mitte sichtbar ist", () => {
  const layout = menuLayout(5, 300, 400, 600);
  assert.equal(layout.cx, 50); // INNER 42 + MARGIN 8
  assert.equal(layout.cy, 300);
});

test("5 Stücke (Block): voller Kreis mit 72° pro Stück, Stück 0 oben", () => {
  const layout = menuLayout(400, 400, 800, 800, 5);
  assert.equal(layout.count, 5);
  assert.equal(segmentAt(...dir(0), layout), 0);
  assert.equal(segmentAt(...dir(72), layout), 1);
  assert.equal(segmentAt(...dir(288), layout), 4);
  // auch im Fächer sind alle 5 erreichbar
  const fan = menuLayout(70, 300, 400, 600, 5);
  const found = new Set();
  for (let a = 0; a < 360; a += 2) {
    const index = segmentAt(...dir(a), fan);
    if (index !== null) found.add(index);
  }
  assert.deepEqual([...found].sort(), [0, 1, 2, 3, 4]);
});

test("Beschriftung pro Aktion (ratings.js)", async () => {
  const { menuCodes, qualityDisplay } = await import("../js/ratings.js");
  assert.deepEqual(menuCodes("block"), ["#", "+", "!", "-", "="]); // ohne "/"
  assert.deepEqual(menuCodes("serve"), ["#", "/", "+", "!", "-", "="]);
  assert.equal(qualityDisplay("#", "serve").key, "look.ace");
  assert.equal(qualityDisplay("/", "serve").text, "++");
  assert.equal(qualityDisplay("#", "reception").text, "++");
  assert.equal(qualityDisplay("/", "reception").key, "look.freeballOver");
  assert.equal(qualityDisplay("/", "set").key, "look.over");
  assert.equal(qualityDisplay("/", "attack").text, "✋");
  assert.equal(qualityDisplay("/", "dig").key, "look.freeball");
  assert.equal(qualityDisplay("!", "set").text, "=");      // "=" heißt im Rad: mittel
  assert.equal(qualityDisplay("=", "attack").text, "✖");   // Fehler
  assert.equal(qualityDisplay("/", "block").text, "/");    // alte Daten bleiben lesbar
});

test("knapp neben dem Fächer zählt noch als erstes bzw. letztes Stück", () => {
  const layout = menuLayout(70, 300, 400, 600);
  const before = layout.start - 10; // 10° vor Beginn des Bogens
  const index = segmentAt(...dir(before), layout);
  assert.ok(index === 0 || index === 5);
});
