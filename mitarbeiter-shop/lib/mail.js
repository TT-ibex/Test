// Versendet die Bestell-Benachrichtigung an den Fanshop-Verantwortlichen.
// Ohne SMTP-Konfiguration wird der Versand übersprungen und stattdessen
// auf der Konsole protokolliert, damit der Shop auch ohne Mailserver läuft.
import nodemailer from 'nodemailer';

export function createMailer(config) {
  const smtp = config.smtp || {};
  const empfaenger = config.bestellEmpfaenger || '';
  const konfiguriert = Boolean(smtp.host && empfaenger);

  let transporter = null;
  if (konfiguriert) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: Boolean(smtp.secure),
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }

  async function bestellungSenden({ user, order, restguthabenCents, euro }) {
    const zeilen = order.items
      .map((i) => `  ${i.menge} x ${i.name}${i.groesse ? ` (Größe ${i.groesse})` : ''} – ${euro(i.preisCents * i.menge)}`)
      .join('\n');
    const text = [
      `Neue Bestellung im Mitarbeiter-Shop`,
      ``,
      `Mitarbeiter: ${user.name} (${user.email})`,
      `Datum: ${new Date(order.createdAt).toLocaleString('de-AT')}`,
      `Bestellnummer: ${order.id}`,
      ``,
      `Positionen:`,
      zeilen,
      ``,
      `Summe: ${euro(order.summeCents)}`,
      `Restguthaben: ${euro(restguthabenCents)}`,
    ].join('\n');

    if (!konfiguriert) {
      console.log(`[mail] SMTP nicht konfiguriert – Benachrichtigung wird nur protokolliert:\n${text}`);
      return;
    }
    try {
      await transporter.sendMail({
        from: smtp.from || smtp.user,
        to: empfaenger,
        subject: `Mitarbeiter-Shop: Bestellung von ${user.name} (${euro(order.summeCents)})`,
        text,
      });
    } catch (err) {
      // Bestellung ist bereits gespeichert; ein Mailfehler darf sie nicht verhindern.
      console.error('[mail] Versand fehlgeschlagen:', err.message);
    }
  }

  return { bestellungSenden, konfiguriert };
}
