import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as store from './lib/store.js';
import { createMailer } from './lib/mail.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ----- Konfiguration: config.json (optional), Umgebungsvariablen haben Vorrang -----
let config = {};
const configFile = path.join(ROOT, 'config.json');
if (fs.existsSync(configFile)) config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
config.port = Number(process.env.PORT || config.port || 3000);
config.bestellEmpfaenger = process.env.BESTELL_EMPFAENGER || config.bestellEmpfaenger || '';
if (process.env.SMTP_HOST) {
  config.smtp = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  };
}

const mailer = createMailer(config);
const db = store.load();

export function euro(cents) {
  return (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
}

// ----- Erster Start: Admin-Konto anlegen -----
if (db.users.length === 0) {
  const email = process.env.ADMIN_EMAIL || 'admin@terratec.cc';
  const passwort = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  db.users.push({
    id: store.neueId(),
    role: 'admin',
    name: 'Administrator',
    email,
    passwordHash: store.hashPassword(passwort),
    active: true,
    jahresguthabenCents: 0,
    createdAt: new Date().toISOString(),
  });
  store.save();
  console.log('================================================================');
  console.log('Erster Start: Admin-Konto wurde angelegt.');
  console.log(`  E-Mail:   ${email}`);
  console.log(`  Passwort: ${process.env.ADMIN_PASSWORD ? '(aus ADMIN_PASSWORD)' : passwort}`);
  console.log('Bitte nach dem ersten Login das Passwort ändern.');
  console.log('================================================================');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

// ----- Session-Handling -----
const SESSION_DAUER_MS = 14 * 24 * 60 * 60 * 1000;

function leseSession(req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('session='));
  if (!cookie) return null;
  const payload = store.verifySession(decodeURIComponent(cookie.slice('session='.length)));
  if (!payload) return null;
  const user = store.findUser(payload.userId);
  return user && user.active ? user : null;
}

function setzeSession(res, user) {
  const token = store.signSession({ userId: user.id, exp: Date.now() + SESSION_DAUER_MS });
  res.setHeader(
    'Set-Cookie',
    `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAUER_MS / 1000}`
  );
}

function angemeldet(req, res, next) {
  req.user = leseSession(req);
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  next();
}

function nurAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur für Administratoren.' });
  next();
}

function userAntwort(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    active: user.active,
    jahresguthabenCents: user.jahresguthabenCents,
    guthabenCents: store.guthabenCents(user.id),
  };
}

// ----- Anmeldung -----
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = store.findUserByEmail(email);
  if (!user || !user.active || !store.checkPassword(String(password || ''), user.passwordHash)) {
    return res.status(401).json({ error: 'E-Mail oder Passwort falsch.' });
  }
  setzeSession(res, user);
  res.json({ user: userAntwort(user) });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', angemeldet, (req, res) => {
  res.json({ user: userAntwort(req.user) });
});

app.post('/api/password', angemeldet, (req, res) => {
  const { alt, neu } = req.body || {};
  if (!store.checkPassword(String(alt || ''), req.user.passwordHash)) {
    return res.status(400).json({ error: 'Aktuelles Passwort ist falsch.' });
  }
  if (String(neu || '').length < 8) {
    return res.status(400).json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben.' });
  }
  req.user.passwordHash = store.hashPassword(String(neu));
  store.save();
  res.json({ ok: true });
});

// ----- Artikel -----
app.get('/api/products', angemeldet, (req, res) => {
  const alle = req.user.role === 'admin' && req.query.all === '1';
  res.json({ products: db.products.filter((p) => alle || p.active) });
});

// ----- Bestellen -----
app.post('/api/orders', angemeldet, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'Der Warenkorb ist leer.' });

  const positionen = [];
  for (const item of items) {
    const produkt = db.products.find((p) => p.id === item.productId && p.active);
    if (!produkt) return res.status(400).json({ error: 'Ein Artikel ist nicht (mehr) verfügbar.' });
    const menge = Math.floor(Number(item.menge));
    if (!Number.isFinite(menge) || menge < 1 || menge > 99) {
      return res.status(400).json({ error: 'Ungültige Menge.' });
    }
    const groesse = item.groesse ? String(item.groesse) : '';
    if (produkt.groessen?.length && !produkt.groessen.includes(groesse)) {
      return res.status(400).json({ error: `Bitte für „${produkt.name}" eine Größe wählen.` });
    }
    positionen.push({ productId: produkt.id, name: produkt.name, preisCents: produkt.preisCents, groesse, menge });
  }

  const summeCents = positionen.reduce((s, p) => s + p.preisCents * p.menge, 0);
  const guthaben = store.guthabenCents(req.user.id);
  if (summeCents > guthaben) {
    return res.status(400).json({
      error: `Guthaben reicht nicht aus (Bestellung ${euro(summeCents)}, verfügbar ${euro(guthaben)}).`,
    });
  }

  const order = {
    id: store.neueId(),
    userId: req.user.id,
    items: positionen,
    summeCents,
    status: 'offen',
    createdAt: new Date().toISOString(),
  };
  db.orders.push(order);
  store.addTransaction({
    userId: req.user.id,
    type: 'bestellung',
    amountCents: -summeCents,
    orderId: order.id,
    note: positionen.map((p) => `${p.menge}x ${p.name}`).join(', '),
  });
  store.save();

  const restguthabenCents = guthaben - summeCents;
  mailer.bestellungSenden({ user: req.user, order, restguthabenCents, euro });
  res.json({ order, guthabenCents: restguthabenCents });
});

app.get('/api/orders', angemeldet, (req, res) => {
  const eigene = db.orders
    .filter((o) => o.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ orders: eigene });
});

// ===== Admin =====

// Mitarbeiter
app.get('/api/admin/users', angemeldet, nurAdmin, (req, res) => {
  res.json({ users: db.users.map(userAntwort) });
});

app.post('/api/admin/users', angemeldet, nurAdmin, (req, res) => {
  const { name, email, jahresguthabenEuro } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name und E-Mail sind erforderlich.' });
  if (store.findUserByEmail(email)) return res.status(400).json({ error: 'E-Mail ist bereits vergeben.' });
  const passwort = crypto.randomBytes(6).toString('base64url');
  const user = {
    id: store.neueId(),
    role: 'mitarbeiter',
    name: String(name).trim(),
    email: String(email).trim(),
    passwordHash: store.hashPassword(passwort),
    active: true,
    jahresguthabenCents: Math.round(Number(jahresguthabenEuro || 0) * 100),
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  store.save();
  res.json({ user: userAntwort(user), startpasswort: passwort });
});

app.put('/api/admin/users/:id', angemeldet, nurAdmin, (req, res) => {
  const user = store.findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
  const { name, email, active, jahresguthabenEuro } = req.body || {};
  if (email !== undefined) {
    const vorhandener = store.findUserByEmail(email);
    if (vorhandener && vorhandener.id !== user.id) {
      return res.status(400).json({ error: 'E-Mail ist bereits vergeben.' });
    }
    user.email = String(email).trim();
  }
  if (name !== undefined) user.name = String(name).trim();
  if (active !== undefined && user.id !== req.user.id) user.active = Boolean(active);
  if (jahresguthabenEuro !== undefined) {
    user.jahresguthabenCents = Math.round(Number(jahresguthabenEuro) * 100);
  }
  store.save();
  res.json({ user: userAntwort(user) });
});

app.post('/api/admin/users/:id/password', angemeldet, nurAdmin, (req, res) => {
  const user = store.findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
  const passwort = crypto.randomBytes(6).toString('base64url');
  user.passwordHash = store.hashPassword(passwort);
  store.save();
  res.json({ startpasswort: passwort });
});

// Manuelle Guthaben-Anpassung (+/-)
app.post('/api/admin/users/:id/guthaben', angemeldet, nurAdmin, (req, res) => {
  const user = store.findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
  const amountCents = Math.round(Number(req.body?.betragEuro) * 100);
  if (!Number.isFinite(amountCents) || amountCents === 0) {
    return res.status(400).json({ error: 'Ungültiger Betrag.' });
  }
  store.addTransaction({
    userId: user.id,
    type: 'anpassung',
    amountCents,
    note: String(req.body?.note || 'Manuelle Anpassung'),
  });
  store.save();
  res.json({ user: userAntwort(user) });
});

// Jährliche Gutschrift: schreibt jedem aktiven Mitarbeiter sein individuelles
// Jahresguthaben gut – pro Jahr höchstens einmal.
app.post('/api/admin/jahresgutschrift', angemeldet, nurAdmin, (req, res) => {
  const jahr = Number(req.body?.jahr) || new Date().getFullYear();
  let gutgeschrieben = 0;
  let uebersprungen = 0;
  for (const user of db.users) {
    if (user.role !== 'mitarbeiter' || !user.active || user.jahresguthabenCents <= 0) continue;
    if (store.hatJahresgutschrift(user.id, jahr)) {
      uebersprungen++;
      continue;
    }
    store.addTransaction({
      userId: user.id,
      type: 'jahresgutschrift',
      amountCents: user.jahresguthabenCents,
      jahr,
      note: `Jahresguthaben ${jahr}`,
    });
    gutgeschrieben++;
  }
  store.save();
  res.json({ jahr, gutgeschrieben, uebersprungen });
});

app.get('/api/admin/users/:id/transactions', angemeldet, nurAdmin, (req, res) => {
  const liste = db.transactions
    .filter((t) => t.userId === req.params.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ transactions: liste });
});

// Artikel
app.post('/api/admin/products', angemeldet, nurAdmin, (req, res) => {
  const { name, beschreibung, preisEuro, groessen, bildUrl } = req.body || {};
  const preisCents = Math.round(Number(preisEuro) * 100);
  if (!name || !Number.isFinite(preisCents) || preisCents < 0) {
    return res.status(400).json({ error: 'Name und gültiger Preis sind erforderlich.' });
  }
  const produkt = {
    id: store.neueId(),
    name: String(name).trim(),
    beschreibung: String(beschreibung || '').trim(),
    preisCents,
    groessen: parseGroessen(groessen),
    bildUrl: String(bildUrl || '').trim(),
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.products.push(produkt);
  store.save();
  res.json({ product: produkt });
});

app.put('/api/admin/products/:id', angemeldet, nurAdmin, (req, res) => {
  const produkt = db.products.find((p) => p.id === req.params.id);
  if (!produkt) return res.status(404).json({ error: 'Artikel nicht gefunden.' });
  const { name, beschreibung, preisEuro, groessen, bildUrl, active } = req.body || {};
  if (name !== undefined) produkt.name = String(name).trim();
  if (beschreibung !== undefined) produkt.beschreibung = String(beschreibung).trim();
  if (preisEuro !== undefined) {
    const preisCents = Math.round(Number(preisEuro) * 100);
    if (!Number.isFinite(preisCents) || preisCents < 0) return res.status(400).json({ error: 'Ungültiger Preis.' });
    produkt.preisCents = preisCents;
  }
  if (groessen !== undefined) produkt.groessen = parseGroessen(groessen);
  if (bildUrl !== undefined) produkt.bildUrl = String(bildUrl).trim();
  if (active !== undefined) produkt.active = Boolean(active);
  store.save();
  res.json({ product: produkt });
});

function parseGroessen(wert) {
  if (Array.isArray(wert)) return wert.map((g) => String(g).trim()).filter(Boolean);
  return String(wert || '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
}

// Bestellungen
app.get('/api/admin/orders', angemeldet, nurAdmin, (req, res) => {
  const liste = db.orders
    .map((o) => ({ ...o, mitarbeiter: store.findUser(o.userId)?.name || '(gelöscht)' }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ orders: liste });
});

app.put('/api/admin/orders/:id', angemeldet, nurAdmin, (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  const status = String(req.body?.status || '');
  if (!['offen', 'erledigt', 'storniert'].includes(status)) {
    return res.status(400).json({ error: 'Ungültiger Status.' });
  }
  if (status === 'storniert' && order.status !== 'storniert') {
    store.addTransaction({
      userId: order.userId,
      type: 'storno',
      amountCents: order.summeCents,
      orderId: order.id,
      note: `Storno Bestellung ${order.id}`,
    });
  }
  if (order.status === 'storniert' && status !== 'storniert') {
    return res.status(400).json({ error: 'Stornierte Bestellungen können nicht reaktiviert werden.' });
  }
  order.status = status;
  order.updatedAt = new Date().toISOString();
  store.save();
  res.json({ order });
});

app.get('/api/admin/orders.csv', angemeldet, nurAdmin, (req, res) => {
  const zelle = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const zeilen = [['Datum', 'Mitarbeiter', 'Artikel', 'Größe', 'Menge', 'Einzelpreis', 'Summe', 'Status', 'Bestellnr.']];
  for (const o of [...db.orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const name = store.findUser(o.userId)?.name || '(gelöscht)';
    for (const i of o.items) {
      zeilen.push([
        new Date(o.createdAt).toLocaleString('de-AT'),
        name,
        i.name,
        i.groesse,
        i.menge,
        (i.preisCents / 100).toFixed(2).replace('.', ','),
        ((i.preisCents * i.menge) / 100).toFixed(2).replace('.', ','),
        o.status,
        o.id,
      ]);
    }
  }
  const csv = '\uFEFF' + zeilen.map((z) => z.map(zelle).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bestellungen.csv"');
  res.send(csv);
});

app.listen(config.port, () => {
  console.log(`Mitarbeiter-Shop läuft auf http://localhost:${config.port}`);
  if (!mailer.konfiguriert) {
    console.log('Hinweis: SMTP ist nicht konfiguriert – Bestell-Mails werden nur protokolliert (siehe config.example.json).');
  }
});
