/* Mitarbeiter-Ansicht: Login, Katalog, Warenkorb, eigene Bestellungen. */
'use strict';

const $ = (sel) => document.querySelector(sel);

let ich = null;
let produkte = [];
const warenkorb = []; // {productId, name, preisCents, groesse, menge}

const euro = (cents) => (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });

async function api(pfad, optionen = {}) {
  const res = await fetch(pfad, {
    headers: { 'Content-Type': 'application/json' },
    ...optionen,
    body: optionen.body ? JSON.stringify(optionen.body) : undefined,
  });
  const daten = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(daten.error || `Fehler ${res.status}`);
  return daten;
}

function melde(text, typ = 'fehler') {
  const el = $('#meldung');
  el.textContent = text;
  el.className = `meldung ${typ}`;
  if (typ === 'ok') setTimeout(() => { el.className = 'meldung'; }, 4000);
}

function zeigeAnsicht() {
  $('#loginAnsicht').classList.toggle('versteckt', Boolean(ich));
  $('#shopAnsicht').classList.toggle('versteckt', !ich);
  $('#logoutBtn').classList.toggle('versteckt', !ich);
  $('#passwortBtn').classList.toggle('versteckt', !ich);
  $('#adminLink').classList.toggle('versteckt', !ich || ich.role !== 'admin');
  $('#kopfGuthaben').classList.toggle('versteckt', !ich);
  if (ich) $('#kopfGuthaben').textContent = `Guthaben: ${euro(ich.guthabenCents)}`;
}

function zeigeProdukte() {
  const wrap = $('#produkte');
  wrap.innerHTML = '';
  if (produkte.length === 0) {
    wrap.innerHTML = '<p class="muted">Derzeit sind keine Artikel verfügbar.</p>';
    return;
  }
  for (const p of produkte) {
    const karte = document.createElement('div');
    karte.className = 'produkt';
    const bild = p.bildUrl ? `<img src="${escapeHtml(p.bildUrl)}" alt="">` : '';
    const groessen = p.groessen?.length
      ? `<select data-groesse><option value="">Größe wählen …</option>${p.groessen.map((g) => `<option>${escapeHtml(g)}</option>`).join('')}</select>`
      : '';
    karte.innerHTML = `
      ${bild}
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="beschreibung">${escapeHtml(p.beschreibung || '')}</div>
      <div class="preis">${euro(p.preisCents)}</div>
      ${groessen}
      <div class="aktionen">
        <input type="number" data-menge value="1" min="1" max="99">
        <button type="button">In den Warenkorb</button>
      </div>`;
    karte.querySelector('button').addEventListener('click', () => {
      const groesse = karte.querySelector('[data-groesse]')?.value || '';
      if (p.groessen?.length && !groesse) return melde(`Bitte für „${p.name}" eine Größe wählen.`);
      const menge = Math.max(1, Math.min(99, Number(karte.querySelector('[data-menge]').value) || 1));
      const vorhanden = warenkorb.find((w) => w.productId === p.id && w.groesse === groesse);
      if (vorhanden) vorhanden.menge += menge;
      else warenkorb.push({ productId: p.id, name: p.name, preisCents: p.preisCents, groesse, menge });
      zeigeWarenkorb();
      melde(`„${p.name}" wurde in den Warenkorb gelegt.`, 'ok');
    });
    wrap.appendChild(karte);
  }
}

function zeigeWarenkorb() {
  const wrap = $('#warenkorbInhalt');
  if (warenkorb.length === 0) {
    wrap.innerHTML = '<p class="muted">Der Warenkorb ist leer.</p>';
  } else {
    const zeilen = warenkorb.map((w, idx) => `
      <tr>
        <td>${escapeHtml(w.name)}${w.groesse ? ` <span class="muted">(Größe ${escapeHtml(w.groesse)})</span>` : ''}</td>
        <td class="num">${w.menge} ×</td>
        <td class="num">${euro(w.preisCents)}</td>
        <td class="num">${euro(w.preisCents * w.menge)}</td>
        <td><button type="button" class="sekundaer klein" data-entfernen="${idx}">Entfernen</button></td>
      </tr>`);
    wrap.innerHTML = `<table><tbody>${zeilen.join('')}</tbody></table>`;
    wrap.querySelectorAll('[data-entfernen]').forEach((btn) =>
      btn.addEventListener('click', () => {
        warenkorb.splice(Number(btn.dataset.entfernen), 1);
        zeigeWarenkorb();
      })
    );
  }
  const summe = warenkorb.reduce((s, w) => s + w.preisCents * w.menge, 0);
  $('#warenkorbSumme').textContent = euro(summe);
  $('#bestellenBtn').disabled = warenkorb.length === 0;
}

async function ladeBestellungen() {
  const { orders } = await api('/api/orders');
  const wrap = $('#meineBestellungen');
  if (orders.length === 0) {
    wrap.innerHTML = '<p class="muted">Noch keine Bestellungen.</p>';
    return;
  }
  const zeilen = orders.map((o) => `
    <tr>
      <td>${new Date(o.createdAt).toLocaleString('de-AT')}</td>
      <td>${o.items.map((i) => `${i.menge}× ${escapeHtml(i.name)}${i.groesse ? ` (${escapeHtml(i.groesse)})` : ''}`).join('<br>')}</td>
      <td class="num">${euro(o.summeCents)}</td>
      <td class="status-${o.status}">${o.status}</td>
    </tr>`);
  wrap.innerHTML = `<table>
    <thead><tr><th>Datum</th><th>Artikel</th><th class="num">Summe</th><th>Status</th></tr></thead>
    <tbody>${zeilen.join('')}</tbody></table>`;
}

async function ladeShop() {
  produkte = (await api('/api/products')).products;
  zeigeProdukte();
  zeigeWarenkorb();
  await ladeBestellungen();
}

function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// ----- Events -----

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { user } = await api('/api/login', {
      method: 'POST',
      body: { email: $('#loginEmail').value, password: $('#loginPasswort').value },
    });
    ich = user;
    zeigeAnsicht();
    await ladeShop();
  } catch (err) {
    melde(err.message);
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

$('#bestellenBtn').addEventListener('click', async () => {
  if (warenkorb.length === 0) return;
  const summe = warenkorb.reduce((s, w) => s + w.preisCents * w.menge, 0);
  if (!confirm(`Bestellung über ${euro(summe)} verbindlich abschicken?`)) return;
  try {
    const { guthabenCents } = await api('/api/orders', {
      method: 'POST',
      body: { items: warenkorb.map((w) => ({ productId: w.productId, groesse: w.groesse, menge: w.menge })) },
    });
    ich.guthabenCents = guthabenCents;
    warenkorb.length = 0;
    zeigeAnsicht();
    zeigeWarenkorb();
    await ladeBestellungen();
    melde('Bestellung wurde erfasst. Vielen Dank!', 'ok');
  } catch (err) {
    melde(err.message);
  }
});

$('#passwortBtn').addEventListener('click', () => $('#passwortDialog').showModal());
$('#pwAbbrechen').addEventListener('click', () => $('#passwortDialog').close());
$('#passwortForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/password', { method: 'POST', body: { alt: $('#pwAlt').value, neu: $('#pwNeu').value } });
    $('#passwortDialog').close();
    e.target.reset();
    melde('Passwort wurde geändert.', 'ok');
  } catch (err) {
    melde(err.message);
  }
});

// ----- Start -----
(async () => {
  try {
    ich = (await api('/api/me')).user;
    zeigeAnsicht();
    await ladeShop();
  } catch {
    zeigeAnsicht(); // nicht angemeldet -> Login zeigen
  }
})();
