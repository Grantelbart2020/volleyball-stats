# CLAUDE.md – Volleyball Statistics

Diese Datei liest Claude Code bei jedem Start. Sie hält fest, wer an diesem Projekt arbeitet, was entschieden ist und wie wir zusammenarbeiten. Nach jedem Meilenstein aktualisieren.

Ausführliches Konzept (Funktionen, Bedienablauf, Bewertungsskala, Datenstruktur): https://claude.ai/artifact/4JD24PWaRX9YbVfYQhqBPj

## Zusammenarbeit

**Sprache:** Immer Deutsch. Code-Kommentare auf Deutsch, Bezeichner im Code auf Englisch.

**Wissensstand des Nutzers:** Grundlegende Python-Syntax, sonst kaum Programmiererfahrung (Excel). Will „Vibecoding": Claude schreibt den Code, der Nutzer will ihn aber später nachvollziehen können.

**Regeln:**
- Schritt für Schritt, ein überschaubarer Entwicklungsschritt pro Pull Request.
- Vor jeder größeren Umsetzung kurz erklären, was und warum.
- Fachbegriffe erklären, Vergleiche zu Python helfen.
- Ehrliches Feedback, bessere Alternativen nennen, keine wichtigen Entscheidungen ohne Erklärung.
- Nie behaupten, etwas sei getestet, wenn es nicht ausgeführt wurde. Klar trennen: automatisch getestet / nicht getestet (Firefox, echtes Handy).
- Fehlende Informationen erfragen, nicht annehmen. Möglichst nur eine wichtige Frage auf einmal.
- Nicht zu viele Aufgaben gleichzeitig an den Nutzer geben.

**Git-Ablauf (wichtig):**
- Repo: `Grantelbart2020/volleyball-stats`, Branch `main` ist geschützt.
- Claude arbeitet IMMER auf einem eigenen Branch (z. B. `meilenstein-3-spiel`) und öffnet einen Pull Request.
- Der Nutzer prüft und **mergt selbst**. Claude mergt nie und pusht nicht direkt auf `main`.
- Der Nutzer holt den Stand mit GitHub Desktop (Fetch origin, Pull origin).
- PR-Beschreibung: was sich ändert (pro Datei), welche Regeln gelten, was getestet ist und was nicht, was der Nutzer danach tun soll.

**Werkzeuge des Nutzers:** Windows-PC mit VS Code + Erweiterung Live Server, Firefox am PC, Chrome am Android-Handy, GitHub Desktop. Die App ist am Handy über GitHub Pages installiert: https://grantelbart2020.github.io/volleyball-stats/

## Projekt

Web-App (PWA) zum Erfassen jeder Ballberührung im Volleyball mit Qualitätsbewertung, live im Spiel oder später per Video. Besonderheit: Auswertung der **Verkettung** aufeinanderfolgender Berührungen (z. B. Annahme-Qualität → Angriffserfolg). Zielgruppe: Spielende und Trainierende; der Nutzer betreut ein Team, die App soll aber für andere nutzbar sein.

## Technik (entschieden)

- PWA mit reinem HTML, CSS, JavaScript (ES-Module), **ohne Framework, ohne Build-Schritt, ohne Abhängigkeiten**. Kosten: 0 €.
- Daten lokal in IndexedDB, nur über `js/db.js`. Kein Server.
- Offline Pflicht (Hallen ohne Netz). Service Worker nur auf https, nicht auf localhost (sonst sieht man beim Entwickeln alte Dateien).
- Deutsch und Englisch umschaltbar. **Kein Text fest im Code**: alles über `i18n/de.json` und `i18n/en.json` (`t("schluessel")` oder `data-i18n`). Neue Schlüssel immer in beiden Dateien.
- Hell/Dunkel umschaltbar, dunkel Standard. Farben nur über CSS-Variablen.
- Läuft in allen aktuellen Browsern, nicht nur Chrome.

## Dateien

```
index.html            Kopfzeile + leerer <main id="app">
manifest.json         Installierbarkeit
service-worker.js     Offline-Cache (stale-while-revalidate)
css/style.css         Aussehen, Farbvariablen, Bewertungsfarben
js/main.js            Start, Einstellungen, Router (#/, #/team/<id>, #/test)
js/i18n.js            Sprachdateien laden, t(), applyTranslations()
js/dom.js             el(...) zum Bauen von Elementen (Text nie als HTML!), confirmButton, showError
js/db.js              IndexedDB: teams, persons, rosterEntries
js/ratings.js         6 Bewertungsstufen (Code, Symbol, Farbe) und 7 Aktionen
js/radial-menu.js     Kreismenü (Ziehen oder Tippen, Mitte wechselt Aktion)
js/radial-test.js     vorläufiger Testbildschirm, wird später ersetzt
js/screen-teams.js    Teamliste
js/screen-team.js     Team: Saison, Kader
i18n/de.json, en.json Texte
icons/                App-Symbole
```

**Bei jeder neuen Datei:** in `APP_FILES` in `service-worker.js` eintragen und `CACHE_VERSION` erhöhen.
**Bei Änderungen am Datenbankaufbau:** `DB_VERSION` in `db.js` erhöhen und einen neuen `if (event.oldVersion < N)`-Block ergänzen. Bestehende Daten des Nutzers dürfen nie verloren gehen.

## Datenmodell

- Jeder Eintrag hat `id` (UUID, Fallback ohne `crypto.randomUUID`), `createdAt`, `updatedAt` – für späteren Export/Import und Sync.
- `teams { id, name }`
- `persons { id, name }` – dauerhaft, über Saisons und Teams hinweg dieselbe Person. **Keine Positionsnamen** (Nutzerentscheidung: Position ergibt sich aus der Rotation).
- `rosterEntries { id, teamId, season, personId, number }` – Saison-Kader. Nummer 0–99, pro Team und Saison eindeutig. Saison `"2026/27"`, Beginn Juli.
- Geplant: Spiel, Satz, Ballwechsel, Ballberührung (mit laufender Nummer im Ballwechsel), Abschlussereignis, Sonderereignisse (Auszeit, Wechsel, Libero-Tausch, Karte).

## Fachliche Entscheidungen

- Bewertungsskala laut Bewertungsgrundlage des Nutzers: 6 Stufen je Aktion, Standardcodes `# + ! - / =` für Speicherung und Export; App zeigt eigene Symbole (★ + ~ − ✖ ⚠) mit Farbe.
- Aktionen: Aufschlag, Annahme, Zuspiel, Angriff, Block, Abwehr, Freeball.
- Jede Berührung wird **einzeln** gespeichert; Verknüpfung erst in der Auswertung. App darf Bewertungen vorschlagen, der Nutzer bestätigt.
- Bedienung: Spieler antippen → Kreismenü, Aktion in der Mitte wird vorgeschlagen und ist änderbar. Zielzone optional als zweiter Schritt (Aufschlag, Angriff), später nachtragbar.
- Zonenraster umschaltbar: 4 Zonen + AUS (Standard) oder 36 Zonen + AUS. Immer die feinste Zone speichern.
- Regeln nach deutschem Volleyball, Regelwerte einstellbar (Kadergröße max. 14 inkl. Libero – noch gegen Spielordnung zu prüfen).
- **Libero wird pro Spiel festgelegt**, nicht an der Person. Ein Libero spielt in diesem Spiel nur Libero, in anderen Spielen kann die Person anders spielen.
- Libero-Tausch: App schlägt zwischen den Ballwechseln vor, Nutzer tippt die Person oder „Kein Wechsel". Zählt nicht als Auswechslung.
- Jeder Punkt wird eingetragen → Rotation und Aufschlagrecht folgen daraus.
- Punkt: Vorschlag aus letzter Aktion mit Bestätigung; manuelle Gründe mit Verursacher (Netzberührung mit Person, Rotationsfehler, Karte als ein Grund, Sonstiges).
- Auszeiten und Spielerwechsel als Ereignisse mit Spielstand.
- Gegner: Kader pro Spiel (Nummer, Name optional). Erfassung umschaltbar: einzelne Gegnerspieler (Standard) oder Gesamtmannschaft.
- Datenaustausch zuerst per Datei-Export/-Import (sprachneutrale Codes), Live-Sync später. Sicherung nach jedem Spiel anbieten.
- Kein integrierter Videoplayer am Anfang.
- Erste Auswertung: Qualität pro Spieler/Aktion, Verkettungen, Punkteverlauf. Später Zonenkarten, Live-Taktik.

## Stand und nächster Schritt

| Meilenstein | Inhalt | Stand |
| --- | --- | --- |
| 0 | Startseite, Sprache, Hell/Dunkel | erledigt |
| 1a | Kreismenü-Prototyp | erledigt, am Handy getestet |
| 1b | PWA installierbar und offline | erledigt, am Handy getestet |
| 2 | Datenbank, Teams, Personen, Saison-Kader | erledigt, vom Nutzer getestet |
| 3 | Spiel und Satz starten, Spielkader (max. 14, Liberos), Aufstellung, Rotation, Libero, Wechsel | **als Nächstes** |
| 4 | Erfassung: Berührungen, Aktionsvorschlag, Zielzone, Punkt, Auszeit | offen |
| 5 | Export, Import, Sicherung | offen |
| 6 | Auswertung 1: Qualität pro Spieler und Aktion | offen |
| 7 | Auswertung 2: Verkettungen, Punkteverlauf | offen |
| 8 | Feinschliff, Offline-Test, Veröffentlichung | offen |

**Nächster Schritt:** Meilenstein 3 planen. Regellogik gehört in eine eigene Datei `js/rules.js` (Rotation, Libero, Wechsel, Satzende), gut kommentiert und mit Testfällen. Vor dem Bauen mit dem Nutzer klären: Spielkader pro Spiel (Auswahl aus Saison-Kader, max. 14, bis zu 2 Liberos), Gegnerkader, Satzregeln (25 Punkte, 5. Satz 15, 2 Punkte Abstand) als einstellbare Werte.

**Offene Punkte:** Kadergröße und Liberos gegen DVV-/Landesverbands-Spielordnung prüfen; englische Fachbegriffe vom Nutzer prüfen lassen; technische Auszeiten je Liga.

## Testen

- Entwicklung: Live Server (localhost), Service Worker ist dort aus.
- Automatische Browsertests mit Playwright sind sinnvoll; Ergebnisse ehrlich im PR nennen.
- Daten liegen pro Gerät und pro Adresse getrennt (localhost ≠ GitHub Pages ≠ Handy).
