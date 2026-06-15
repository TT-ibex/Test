# TerraTec Mitarbeiter-Shop

Interner Web-Shop, über den Mitarbeiter die Fanshop-Artikel mit einem persönlichen
Guthaben bestellen können.

## Funktionen

**Für Mitarbeiter** (`index.html`):
- Anmeldung mit E-Mail und Passwort
- Artikelkatalog mit Bild, Beschreibung, Preis und Größenauswahl (z. B. T-Shirts)
- Warenkorb und verbindliche Bestellung – nur möglich, solange das Guthaben reicht
- Aktuelles Guthaben immer sichtbar, eigene Bestellhistorie mit Status
- Passwort selbst änderbar

**Für Administratoren** (`admin.html`, Schaltfläche „Verwaltung"):
- **Bestellungen:** Übersicht aller Bestellungen (wer, was, wann, Summe), Status
  „offen → erledigt", Stornierung mit automatischer Guthaben-Rückbuchung,
  CSV-Export für Excel
- **Mitarbeiter & Guthaben:** Mitarbeiter anlegen/bearbeiten/deaktivieren,
  Passwort zurücksetzen (Startpasswort wird angezeigt), **individuelles
  Jahresguthaben pro Mitarbeiter**, manuelle Guthaben-Buchungen (±) mit Anmerkung
- **Jahresgutschrift:** Ein Klick schreibt jedem aktiven Mitarbeiter sein
  individuelles Jahresguthaben gut – pro Jahr nur einmal möglich (doppelte
  Buchung wird automatisch verhindert)
- **Artikel:** Artikel anlegen/bearbeiten/deaktivieren (Name, Preis, Beschreibung,
  Größen, Bild-URL)

Bei jeder Bestellung wird eine **E-Mail an den Fanshop-Verantwortlichen**
gesendet (Artikel, Mengen, Größen, Summe, Restguthaben des Mitarbeiters).

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.

```bash
cd mitarbeiter-shop
npm install
npm start
# dann http://localhost:3000 öffnen
```

Beim **ersten Start** wird ein Admin-Konto angelegt und das Passwort einmalig
auf der Konsole ausgegeben (anpassbar über die Umgebungsvariablen `ADMIN_EMAIL`
und `ADMIN_PASSWORD`). Bitte nach dem ersten Login das Passwort ändern.

## E-Mail-Benachrichtigung einrichten

`config.example.json` nach `config.json` kopieren und SMTP-Zugangsdaten sowie
die Empfängeradresse (`bestellEmpfaenger`) eintragen:

```bash
cp config.example.json config.json
# config.json bearbeiten
```

Alternativ per Umgebungsvariablen: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` und `BESTELL_EMPFAENGER`.
Ohne SMTP-Konfiguration läuft der Shop trotzdem – Benachrichtigungen werden
dann nur auf der Konsole protokolliert.

## Typischer Ablauf

1. Admin legt die Fanshop-Artikel an (Verwaltung → Artikel).
2. Admin legt die Mitarbeiter mit ihrem individuellen Jahresguthaben an und
   teilt ihnen das Startpasswort mit.
3. Am Jahresanfang: Verwaltung → Mitarbeiter → **„Jahresguthaben gutschreiben"**.
4. Mitarbeiter melden sich an und bestellen; das Guthaben wird automatisch
   abgezogen und der Verantwortliche per E-Mail informiert.
5. Ausgegebene Ware in der Bestellliste auf „Erledigt" setzen; bei Bedarf
   stornieren (Guthaben kommt zurück).

## Technik & Daten

- Node.js + Express, keine Datenbank nötig: alle Daten liegen in
  `data/db.json` (wird automatisch angelegt, ist von Git ausgenommen).
  **Backup = diese eine Datei sichern.**
- Guthaben wird als Buchungsjournal geführt (Jahresgutschrift, Bestellung,
  Storno, manuelle Anpassung) – jeder Kontostand ist damit nachvollziehbar.
- Passwörter werden gehasht (scrypt) gespeichert, Sitzungen laufen über
  signierte Cookies.
- Für den Produktivbetrieb im Firmennetz hinter HTTPS (z. B. Reverse-Proxy)
  betreiben; der Shop selbst spricht HTTP auf Port 3000 (`PORT` anpassbar).
