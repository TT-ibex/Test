// Einfache JSON-Datei-Datenhaltung. Für einen internen Shop mit wenigen
// hundert Nutzern ausreichend; alle Schreibzugriffe laufen über save()
// und werden atomar (tmp + rename) geschrieben.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const LEER = { users: [], products: [], orders: [], transactions: [] };

let db = null;

export function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = { ...LEER, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } else {
    db = structuredClone(LEER);
  }
  return db;
}

export function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function neueId() {
  return crypto.randomBytes(8).toString('hex');
}

export function findUser(id) {
  return load().users.find((u) => u.id === id) || null;
}

export function findUserByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return load().users.find((u) => u.email.toLowerCase() === e) || null;
}

export function guthabenCents(userId) {
  return load()
    .transactions.filter((t) => t.userId === userId)
    .reduce((sum, t) => sum + t.amountCents, 0);
}

export function addTransaction({ userId, type, amountCents, jahr = null, orderId = null, note = '' }) {
  const t = {
    id: neueId(),
    userId,
    type, // 'jahresgutschrift' | 'anpassung' | 'bestellung' | 'storno'
    amountCents,
    jahr,
    orderId,
    note,
    createdAt: new Date().toISOString(),
  };
  load().transactions.push(t);
  return t;
}

export function hatJahresgutschrift(userId, jahr) {
  return load().transactions.some(
    (t) => t.userId === userId && t.type === 'jahresgutschrift' && t.jahr === jahr
  );
}

// ----- Passwörter & Sessions -----

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const probe = crypto.scryptSync(password, salt, 32);
  const ist = Buffer.from(hash, 'hex');
  return ist.length === probe.length && crypto.timingSafeEqual(probe, ist);
}

let sessionSecret = null;

export function getSessionSecret() {
  if (sessionSecret) return sessionSecret;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'session-secret');
  if (fs.existsSync(file)) {
    sessionSecret = fs.readFileSync(file, 'utf8').trim();
  } else {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, sessionSecret, { mode: 0o600 });
  }
  return sessionSecret;
}

export function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySession(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig) return null;
  const erwartet = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(erwartet);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.userId || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
