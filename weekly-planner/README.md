# 🗓️ Wochenplaner

Ein **lokaler Wochenplaner**, der Aufgaben automatisch **nach Wichtigkeit und Deadline** über die Woche verteilt. Modernes, dunkles Design, optimiert für das **iPhone 16 Pro Max**. Läuft komplett **offline auf dem Handy** – kein Server, kein Account, keine Datenübertragung.

## Funktionen

- **Automatische Planung** – Aufgaben werden logisch über die Woche verteilt:
  - Wichtige und dringende Aufgaben kommen **zuerst** und möglichst **früh**.
  - **Deadlines** werden eingehalten (eine Aufgabe wird nie nach ihrer Frist eingeplant).
  - Die **Tageslast** wird ausbalanciert (Standard: 5 Std. produktive Planzeit pro Tag).
  - **Feste Termine** lassen sich auf einen bestimmten Wochentag fixieren.
- **Wichtigkeit in 5 Stufen** (Niedrig → Kritisch) mit farblicher Kennzeichnung.
- **Wochen- und Tagesansicht**, Navigation zwischen Wochen, Übersicht mit Kennzahlen.
- **Abhaken**, Bearbeiten, Löschen von Aufgaben.
- **Lokale Speicherung** im Browser-Speicher des Geräts (`localStorage`).
- **Offline-fähig** dank Service Worker (PWA) – nach dem ersten Laden ohne Internet nutzbar.

## Auf dem iPhone installieren

Da Apple nur über Xcode/App Store native Apps erlaubt, wird die App als **PWA** (Web-App zum Home-Bildschirm) installiert – sie verhält sich dann wie eine echte App im Vollbild.

1. **Dateien aufs iPhone bringen / bereitstellen.** Du brauchst die App über `https://` oder `localhost` erreichbar (Service Worker funktioniert nicht über `file://`). Drei einfache Wege:

   **A) Über den Mac/PC im gleichen WLAN (am einfachsten):**
   ```bash
   cd weekly-planner
   python3 -m http.server 8080
   ```
   Dann am iPhone in **Safari** öffnen: `http://<IP-deines-Rechners>:8080`
   (IP z. B. via `ipconfig getifaddr en0` auf dem Mac).

   **B) Kostenloses Hosting:** Ordner `weekly-planner/` zu GitHub Pages, Netlify oder Vercel hochladen und die URL in Safari öffnen.

2. In **Safari** auf das **Teilen-Symbol** (Quadrat mit Pfeil) tippen.
3. **„Zum Home-Bildschirm"** wählen → **Hinzufügen**.
4. Fertig: Das Symbol „Planer" liegt nun auf dem Home-Bildschirm und startet im Vollbild – auch offline.

> Wichtig: **Safari** verwenden (nicht Chrome), damit „Zum Home-Bildschirm" und der Offline-Modus korrekt funktionieren.

## So plant die App (Algorithmus)

1. **Feste Aufgaben** werden zuerst auf ihren Wochentag gelegt.
2. Alle anderen Aufgaben bekommen eine **Punktzahl** aus Wichtigkeit (× 100) und Dringlichkeit (Bonus, je näher die Deadline). Überfällige/heute fällige Aufgaben erhalten den höchsten Bonus.
3. Aufgaben werden nach Punktzahl absteigend einsortiert: für jede wird der **früheste Tag** im erlaubten Fenster (ab heute bis zur Deadline) gesucht, der noch **Kapazität** hat. Passt nichts mehr, wird der Tag mit der **geringsten Last** gewählt.
4. Innerhalb jedes Tages stehen **wichtige Aufgaben oben**, erledigte unten.

Die Planung ist deterministisch und wird bei jeder Änderung neu berechnet.

## Technik

- Reines **HTML / CSS / JavaScript**, keine Frameworks, kein Build-Schritt.
- **PWA** mit `manifest.webmanifest` und `sw.js` (Service Worker, Cache-first).
- iPhone-Anpassung: `viewport-fit=cover` + `env(safe-area-inset-*)` für Dynamic Island und Home-Indicator, `apple-mobile-web-app-capable` für Vollbild.
- Icons werden ohne externe Tools per `python3 generate_icons.py` erzeugt.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | App-Grundgerüst & Meta-Tags fürs iPhone |
| `styles.css` | Dunkles UI, Safe-Area-Anpassung |
| `app.js` | Zustand, Planer-Algorithmus, Rendering |
| `manifest.webmanifest` | PWA-Manifest |
| `sw.js` | Service Worker (Offline) |
| `icons/` | App-Icons (192/512/180 px) |
| `generate_icons.py` | erzeugt die Icons neu |

## Anpassen

- **Tageskapazität** ändern: Konstante `DAILY_CAPACITY` (Minuten) in `app.js`.
- **Akzent-/Designfarben**: CSS-Variablen oben in `styles.css` (`--accent`, `--p1`…`--p5`).
