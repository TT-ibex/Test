# PDF-Rechnungsauswertung

Eine Webseite, mit der bis zu **200 PDF-Rechnungen auf einmal** hochgeladen und ausgewertet werden können. Die Seite erkennt in jeder Rechnung die Artikelnummern, die zugehörigen Mengen und das Rechnungsdatum und zeigt am Ende eine Übersicht: **welche Menge von welchem Artikel in welchem Monat verrechnet wurde** (Tabelle Artikel × Monat, inkl. Summenzeile und CSV-Export).

**Datenschutz:** Die Auswertung läuft vollständig lokal im Browser (mit [pdf.js](https://mozilla.github.io/pdf.js/)). Es werden keine Dateien auf einen Server hochgeladen.

## Benutzung

1. `index.html` im Browser öffnen (siehe [Starten](#starten)).
2. PDFs per Drag & Drop in das Feld ziehen oder über „Dateien auswählen" hochladen (bis zu 200 gleichzeitig, mehrere Durchgänge sind möglich – die Ergebnisse werden zusammengeführt).
3. Die Ergebnistabelle zeigt pro Artikelnummer die summierte Menge je Monat. Über **„CSV exportieren"** lässt sich die Tabelle für Excel herunterladen.
4. In der Dateiliste darunter ist pro PDF sichtbar, welches Datum und welche Positionen erkannt wurden („Details" zeigt den extrahierten Text und alle Treffer).

## Erkennung anpassen

Da Rechnungslayouts unterschiedlich sind, ist die Positionserkennung konfigurierbar:

- **Vorlage / Zeilen-Muster:** Ein regulärer Ausdruck, der auf jede Textzeile angewendet wird. Die benannte Gruppe `(?<artikel>…)` liefert die Artikelnummer, `(?<menge>…)` die Menge. Fehlt die Mengen-Gruppe, zählt jeder Treffer als 1. Es stehen mehrere Vorlagen zur Auswahl (Menge mit Einheit „Stk", Artikelnummer am Zeilenanfang usw.).
- **Datums-Schlüsselwörter:** Für die Monatszuordnung wird zuerst nach einem Datum in einer Zeile mit diesen Begriffen gesucht (z. B. „Rechnungsdatum"), sonst gilt das erste Datum im Dokument. Unterstützte Formate: `31.12.2025`, `31.12.25`, `2025-12-31`.

**Tipp zum Einstellen:** Erst ein paar PDFs hochladen, dann in der Dateiliste auf „Details" klicken – dort sieht man den extrahierten Text der Rechnung und kann das Muster passend anpassen. Änderungen am Muster werden **sofort auf alle bereits eingelesenen PDFs angewendet**, ohne dass man sie erneut hochladen muss.

**Hinweis:** Gescannte PDFs ohne Textebene (reine Bilder) können nicht ausgewertet werden – dafür wäre vorher eine OCR-Verarbeitung nötig. Solche Dateien werden in der Dateiliste mit einem Hinweis markiert.

## Starten

Am einfachsten direkt `index.html` doppelklicken – die Seite funktioniert auch ohne Webserver.

Alternativ mit lokalem Webserver (schneller bei vielen PDFs, da pdf.js dann in einem Hintergrund-Thread arbeitet):

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Oder über **GitHub Pages** veröffentlichen (Repository-Einstellungen → Pages → Branch auswählen), dann ist die Seite ohne Installation für alle erreichbar.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Seite mit Upload, Einstellungen und Ergebnistabellen |
| `app.js` | PDF-Textextraktion, Datums-/Positionserkennung, Aggregation, CSV-Export |
| `styles.css` | Layout |
| `vendor/pdf.min.js`, `vendor/pdf.worker.min.js` | pdf.js 3.11.174 (lokal eingebunden, Lizenz: `vendor/PDFJS-LICENSE`) |
