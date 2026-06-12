/* Verwaltung: Bestellungen, Mitarbeiter & Guthaben, Artikel. */
'use strict';

const $ = (sel) => document.querySelector(sel);
const euro = (cents) => (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });

let guthabenUserId = null;
let bearbeiteUserId = null;
let bearbeiteArtikelId = null;
let artikelCache = [];

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
  if (typ === 'ok') setTimeout(() => { el.className = 'meldung'; }, 6000);
}

function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// ----- Tabs -----
document.querySelectorAll('.tabs button').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('aktiv', b === btn));
    document.querySelectorAll('main > section').forEach((s) =>
      s.classList.toggle('versteckt', s.id !== `tab-${btn.dataset.tab}`)
    );
  })
);

// ----- Bestellungen -----
async function ladeBestellungen() {
  const { orders } = await api('/api/admin/orders');
  const wrap = $('#bestellListe');
  if (orders.length === 0) {
    wrap.innerHTML = '<p class="muted">Noch keine Bestellungen.</p>';
    return;
  }
  const zeilen = orders.map((o) => `
    <tr>
      <td>${new Date(o.createdAt).toLocaleString('de-AT')}</td>
      <td>${escapeHtml(o.mitarbeiter)}</td>
      <td>${o.items.map((i) => `${i.menge}× ${escapeHtml(i.name)}${i.groesse ? ` (${escapeHtml(i.groesse)})` : ''}`).join('<br>')}</td>
      <td class="num">${euro(o.summeCents)}</td>
      <td class="status-${o.status}">${o.status}</td>
      <td>
        ${o.status === 'offen' ? `<button class="klein" data-status="erledigt" data-id="${o.id}" type="button">Erledigt</button>` : ''}
        ${o.status !== 'storniert' ? `<button class="klein sekundaer" data-status="storniert" data-id="${o.id}" type="button">Stornieren</button>` : ''}
      </td>
    </tr>`);
  wrap.innerHTML = `<table>
    <thead><tr><th>Datum</th><th>Mitarbeiter</th><th>Artikel</th><th class="num">Summe</th><th>Status</th><th></th></tr></thead>
    <tbody>${zeilen.join('')}</tbody></table>`;
  wrap.querySelectorAll('button[data-status]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const status = btn.dataset.status;
      if (status === 'storniert' && !confirm('Bestellung stornieren? Das Guthaben wird zurückgebucht.')) return;
      try {
        await api(`/api/admin/orders/${btn.dataset.id}`, { method: 'PUT', body: { status } });
        await Promise.all([ladeBestellungen(), ladeMitarbeiter()]);
      } catch (err) {
        melde(err.message);
      }
    })
  );
}

// ----- Mitarbeiter -----
async function ladeMitarbeiter() {
  const { users } = await api('/api/admin/users');
  const wrap = $('#mitarbeiterListe');
  const zeilen = users.map((u) => `
    <tr${u.active ? '' : ' style="opacity:0.5"'}>
      <td>${escapeHtml(u.name)}${u.role === 'admin' ? ' <span class="muted">(Admin)</span>' : ''}${u.active ? '' : ' <span class="muted">(deaktiviert)</span>'}</td>
      <td>${escapeHtml(u.email)}</td>
      <td class="num">${euro(u.jahresguthabenCents)}</td>
      <td class="num"><strong>${euro(u.guthabenCents)}</strong></td>
      <td>
        <button class="klein" data-aktion="guthaben" data-id="${u.id}" type="button">Guthaben ±</button>
        <button class="klein sekundaer" data-aktion="bearbeiten" data-id="${u.id}" type="button">Bearbeiten</button>
        <button class="klein sekundaer" data-aktion="passwort" data-id="${u.id}" type="button">Passwort zurücksetzen</button>
        ${u.role === 'mitarbeiter' ? `<button class="klein sekundaer" data-aktion="aktiv" data-id="${u.id}" data-aktiv="${u.active}" type="button">${u.active ? 'Deaktivieren' : 'Aktivieren'}</button>` : ''}
      </td>
    </tr>`);
  wrap.innerHTML = `<table>
    <thead><tr><th>Name</th><th>E-Mail</th><th class="num">Jahresguthaben</th><th class="num">Aktuelles Guthaben</th><th></th></tr></thead>
    <tbody>${zeilen.join('')}</tbody></table>`;

  wrap.querySelectorAll('button[data-aktion]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const user = users.find((u) => u.id === id);
      try {
        if (btn.dataset.aktion === 'guthaben') {
          guthabenUserId = id;
          $('#gdName').textContent = user.name;
          $('#guthabenForm').reset();
          $('#guthabenDialog').showModal();
        } else if (btn.dataset.aktion === 'bearbeiten') {
          bearbeiteUserId = id;
          $('#mdName').value = user.name;
          $('#mdEmail').value = user.email;
          $('#mdJahresguthaben').value = (user.jahresguthabenCents / 100).toFixed(2);
          $('#mitarbeiterDialog').showModal();
        } else if (btn.dataset.aktion === 'passwort') {
          if (!confirm(`Passwort von ${user.name} zurücksetzen?`)) return;
          const { startpasswort } = await api(`/api/admin/users/${id}/password`, { method: 'POST' });
          melde(`Neues Startpasswort für ${user.name}: ${startpasswort}`, 'ok');
        } else if (btn.dataset.aktion === 'aktiv') {
          await api(`/api/admin/users/${id}`, { method: 'PUT', body: { active: btn.dataset.aktiv !== 'true' } });
          await ladeMitarbeiter();
        }
      } catch (err) {
        melde(err.message);
      }
    })
  );
}

$('#neuerMitarbeiterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { user, startpasswort } = await api('/api/admin/users', {
      method: 'POST',
      body: {
        name: $('#nmName').value,
        email: $('#nmEmail').value,
        jahresguthabenEuro: $('#nmJahresguthaben').value,
      },
    });
    e.target.reset();
    melde(`${user.name} wurde angelegt. Startpasswort: ${startpasswort}`, 'ok');
    await ladeMitarbeiter();
  } catch (err) {
    melde(err.message);
  }
});

$('#jahresgutschriftBtn').addEventListener('click', async () => {
  const jahr = Number($('#jgJahr').value);
  if (!confirm(`Jahresguthaben ${jahr} jetzt allen aktiven Mitarbeitern gutschreiben?`)) return;
  try {
    const ergebnis = await api('/api/admin/jahresgutschrift', { method: 'POST', body: { jahr } });
    melde(
      `Jahresguthaben ${ergebnis.jahr}: ${ergebnis.gutgeschrieben} Gutschrift(en) gebucht, ${ergebnis.uebersprungen} bereits vorhanden.`,
      'ok'
    );
    await ladeMitarbeiter();
  } catch (err) {
    melde(err.message);
  }
});

$('#guthabenForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/admin/users/${guthabenUserId}/guthaben`, {
      method: 'POST',
      body: { betragEuro: $('#gdBetrag').value, note: $('#gdNote').value },
    });
    $('#guthabenDialog').close();
    await ladeMitarbeiter();
  } catch (err) {
    melde(err.message);
  }
});
$('#gdAbbrechen').addEventListener('click', () => $('#guthabenDialog').close());

$('#mitarbeiterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/admin/users/${bearbeiteUserId}`, {
      method: 'PUT',
      body: {
        name: $('#mdName').value,
        email: $('#mdEmail').value,
        jahresguthabenEuro: $('#mdJahresguthaben').value,
      },
    });
    $('#mitarbeiterDialog').close();
    await ladeMitarbeiter();
  } catch (err) {
    melde(err.message);
  }
});
$('#mdAbbrechen').addEventListener('click', () => $('#mitarbeiterDialog').close());

// ----- Artikel -----
async function ladeArtikel() {
  artikelCache = (await api('/api/products?all=1')).products;
  const wrap = $('#artikelListe');
  if (artikelCache.length === 0) {
    wrap.innerHTML = '<p class="muted">Noch keine Artikel angelegt.</p>';
    return;
  }
  const zeilen = artikelCache.map((p) => `
    <tr${p.active ? '' : ' style="opacity:0.5"'}>
      <td>${escapeHtml(p.name)}${p.active ? '' : ' <span class="muted">(inaktiv)</span>'}</td>
      <td>${escapeHtml(p.beschreibung || '')}</td>
      <td>${(p.groessen || []).map(escapeHtml).join(', ')}</td>
      <td class="num">${euro(p.preisCents)}</td>
      <td>
        <button class="klein sekundaer" data-aktion="bearbeiten" data-id="${p.id}" type="button">Bearbeiten</button>
        <button class="klein sekundaer" data-aktion="aktiv" data-id="${p.id}" data-aktiv="${p.active}" type="button">${p.active ? 'Deaktivieren' : 'Aktivieren'}</button>
      </td>
    </tr>`);
  wrap.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Beschreibung</th><th>Größen</th><th class="num">Preis</th><th></th></tr></thead>
    <tbody>${zeilen.join('')}</tbody></table>`;
  wrap.querySelectorAll('button[data-aktion]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const p = artikelCache.find((x) => x.id === btn.dataset.id);
      try {
        if (btn.dataset.aktion === 'bearbeiten') {
          bearbeiteArtikelId = p.id;
          $('#adName').value = p.name;
          $('#adPreis').value = (p.preisCents / 100).toFixed(2);
          $('#adGroessen').value = (p.groessen || []).join(', ');
          $('#adBeschreibung').value = p.beschreibung || '';
          $('#adBild').value = p.bildUrl || '';
          $('#artikelDialog').showModal();
        } else {
          await api(`/api/admin/products/${p.id}`, { method: 'PUT', body: { active: btn.dataset.aktiv !== 'true' } });
          await ladeArtikel();
        }
      } catch (err) {
        melde(err.message);
      }
    })
  );
}

$('#neuerArtikelForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/products', {
      method: 'POST',
      body: {
        name: $('#naName').value,
        preisEuro: $('#naPreis').value,
        groessen: $('#naGroessen').value,
        beschreibung: $('#naBeschreibung').value,
        bildUrl: $('#naBild').value,
      },
    });
    e.target.reset();
    await ladeArtikel();
    melde('Artikel wurde angelegt.', 'ok');
  } catch (err) {
    melde(err.message);
  }
});

$('#artikelForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/admin/products/${bearbeiteArtikelId}`, {
      method: 'PUT',
      body: {
        name: $('#adName').value,
        preisEuro: $('#adPreis').value,
        groessen: $('#adGroessen').value,
        beschreibung: $('#adBeschreibung').value,
        bildUrl: $('#adBild').value,
      },
    });
    $('#artikelDialog').close();
    await ladeArtikel();
  } catch (err) {
    melde(err.message);
  }
});
$('#adAbbrechen').addEventListener('click', () => $('#artikelDialog').close());

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = 'index.html';
});

// ----- Start -----
(async () => {
  try {
    const { user } = await api('/api/me');
    if (user.role !== 'admin') {
      location.href = 'index.html';
      return;
    }
    $('#jgJahr').value = new Date().getFullYear();
    await Promise.all([ladeBestellungen(), ladeMitarbeiter(), ladeArtikel()]);
  } catch {
    location.href = 'index.html';
  }
})();
