/* PDF-Rechnungsauswertung: Artikelmengen pro Monat summieren.
   Läuft komplett im Browser – keine Daten verlassen den Rechner. */
"use strict";

pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const MAX_FILES = 200;
const CONCURRENCY = 4;

/* ---------- Vorlagen für die Positionserkennung ---------- */

const PRESETS = [
  {
    name: "Menge mit Einheit (z. B. „ART-123 … 5 Stk“)",
    regex: "(?<artikel>[A-Za-z]{0,4}[-./]?\\d[\\w.\\-/]{2,})\\b.*?\\b(?<menge>\\d{1,6}(?:[.,]\\d{1,3})?)\\s*(?:Stk\\.?|Stück|Stck\\.?|St\\.?|Pcs\\.?|x)\\b",
  },
  {
    name: "Artikelnummer am Zeilenanfang, Menge direkt danach",
    regex: "^\\s*(?:\\d{1,4}\\s+)?(?<artikel>[A-Za-z]{0,4}[-./]?\\d[\\w.\\-/]{2,})\\s+(?<menge>\\d{1,6}(?:[.,]\\d{1,3})?)\\b",
  },
  {
    name: "Menge am Zeilenanfang, Artikelnummer danach (z. B. „5 ART-123 …“)",
    regex: "^\\s*(?<menge>\\d{1,6}(?:[.,]\\d{1,3})?)\\s+(?<artikel>[A-Za-z]{0,4}[-./]?\\d[\\w.\\-/]{2,})\\b",
  },
  {
    name: "Nur Artikelnummer zählen (jeder Treffer = 1)",
    regex: "\\b(?<artikel>[A-Za-z]{2,4}-\\d{3,})\\b",
  },
];

/* Standard-Muster für den mehrzeiligen Modus:
   Positionszeile wie „01 1 Stk. Grundgerät …“ oder „03 1 SET Option …“,
   Artikelnummer in eigener Zeile wie „Art. Nr.: 0430 0043“ (Rev.-Zusatz wird abgeschnitten). */
const DEFAULT_POS_REGEX =
  "^\\s*\\d{1,3}\\s+(?<menge>\\d{1,6}(?:[.,]\\d{1,3})?)\\s*(?:Stk\\.?|Stück|SET|Set|Paar|Pcs\\.?|kg|m|Std\\.?|h)\\b\\s*(?<text>.*)$";
const DEFAULT_ART_REGEX =
  "^\\s*Art\\.?\\s*-?\\s*Nr\\.?\\s*:?\\s*(?<artikel>.+?)(?:\\s+Rev\\b.*)?$";

/* Standard-Produktgruppen: Zuordnung über die Produktbezeichnung.
   Nur Grundgeräte-Zeilen zählen für G1–AX (Optionen erwähnen die Modelle
   ebenfalls, enthalten aber nicht das Wort „Grundgerät“). */
const DEFAULT_GROUPS = [
  "G1 = Grundgerät.*Ibex.*\\bG1\\b",
  "G2 = Grundgerät.*Ibex.*\\bG2\\b",
  "G3 = Grundgerät.*Ibex.*\\bG3\\b(?!-V)",
  "G3-V = Grundgerät.*Ibex.*G3-V",
  "G4 = Grundgerät.*Ibex.*\\bG4\\b",
  "AX = Grundgerät.*Ibex.*\\bAX\\b",
  "Summe",
  'LS Grip 12" 2er Satz = (?=.*LS.?Grip)(?=.*\\b12\\b)(?=.*\\b2er)',
  'LS Grip 12" 4er Satz = (?=.*LS.?Grip)(?=.*\\b12\\b)(?=.*\\b4er)',
  'LS Grip 12" (ohne Satzangabe) = (?=.*LS.?Grip)(?=.*\\b12\\b)',
  'LS Grip 15" 2er Satz = (?=.*LS.?Grip)(?=.*\\b15\\b)(?=.*\\b2er)',
  'LS Grip 15" 4er Satz = (?=.*LS.?Grip)(?=.*\\b15\\b)(?=.*\\b4er)',
  'LS Grip 15" (ohne Satzangabe) = (?=.*LS.?Grip)(?=.*\\b15\\b)',
  "Summe",
  "Mähwerk 196 = (?=.*M\\S*hwerk)(?=.*\\b196)",
  "Mähwerk 238 = (?=.*M\\S*hwerk)(?=.*\\b238)",
  "Mähwerk 240 = (?=.*M\\S*hwerk)(?=.*\\b240)",
  "Mähwerk 260 = (?=.*M\\S*hwerk)(?=.*\\b260)",
  "Mähwerk 300 = (?=.*M\\S*hwerk)(?=.*\\b300)",
  "Mähwerk 350 = (?=.*M\\S*hwerk)(?=.*\\b350)",
  "Mähwerk 390 = (?=.*M\\S*hwerk)(?=.*\\b390)",
  "Mähwerk 430 = (?=.*M\\S*hwerk)(?=.*\\b430)",
  "Mähwerk 470 = (?=.*M\\S*hwerk)(?=.*\\b470)",
  "Ino Ibex 145 = (?=.*\\bIno)(?=.*\\b145)",
  "Ino Ibex 165 = (?=.*\\bIno)(?=.*\\b165)",
  "Ino Ibex 185 = (?=.*\\bIno)(?=.*\\b185)",
  "Summe",
].join("\n");

/* ---------- Zustand ---------- */

/** @type {Array<{name:string, status:string, message:string, date:Date|null, monthKey:string|null, lines:string[], items:Array<{artikel:string, menge:number, line:string}>}>} */
let fileResults = [];
let processing = false;

/* ---------- DOM ---------- */

const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("fileInput");
const presetSelect = $("presetSelect");
const lineRegexInput = $("lineRegex");
const regexError = $("regexError");
const dateKeywordsInput = $("dateKeywords");
const dedupeCheckbox = $("dedupeLines");
const modeSelect = $("modeSelect");
const posLineRegexInput = $("posLineRegex");
const artLineRegexInput = $("artLineRegex");
const posRegexError = $("posRegexError");
const artRegexError = $("artRegexError");
const groupConfigInput = $("groupConfig");
const groupConfigError = $("groupConfigError");

/* ---------- Initialisierung ---------- */

PRESETS.forEach((p, i) => {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = p.name;
  presetSelect.appendChild(opt);
});
const custom = document.createElement("option");
custom.value = "custom";
custom.textContent = "Eigenes Muster";
presetSelect.appendChild(custom);
lineRegexInput.value = PRESETS[0].regex;
posLineRegexInput.value = DEFAULT_POS_REGEX;
artLineRegexInput.value = DEFAULT_ART_REGEX;
groupConfigInput.value = DEFAULT_GROUPS;
groupConfigInput.addEventListener("input", debounce(() => {
  parseGroupConfig();
  renderAll();
}, 400));

function currentMode() {
  return modeSelect.value === "singleline" ? "singleline" : "multiline";
}
function updateModeVisibility() {
  $("multilineFields").hidden = currentMode() !== "multiline";
  $("singlelineFields").hidden = currentMode() !== "singleline";
}
modeSelect.addEventListener("change", () => {
  updateModeVisibility();
  reanalyzeAll();
});
posLineRegexInput.addEventListener("input", debounce(reanalyzeAll, 400));
artLineRegexInput.addEventListener("input", debounce(reanalyzeAll, 400));

presetSelect.addEventListener("change", () => {
  if (presetSelect.value !== "custom") {
    lineRegexInput.value = PRESETS[Number(presetSelect.value)].regex;
  }
  reanalyzeAll();
});
lineRegexInput.addEventListener("input", debounce(() => {
  presetSelect.value = "custom";
  reanalyzeAll();
}, 400));
dateKeywordsInput.addEventListener("input", debounce(reanalyzeAll, 400));
dedupeCheckbox.addEventListener("change", reanalyzeAll);

updateModeVisibility();

$("exportCsvBtn").addEventListener("click", exportCsv);
$("resetBtn").addEventListener("click", () => {
  fileResults = [];
  renderAll();
});
$("detailClose").addEventListener("click", () => $("detailDialog").close());

fileInput.addEventListener("change", () => {
  handleFiles(Array.from(fileInput.files));
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  handleFiles(Array.from(e.dataTransfer.files));
});

/* ---------- Datei-Verarbeitung ---------- */

async function handleFiles(files) {
  const pdfs = files.filter(
    (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
  );
  if (!pdfs.length) {
    alert("Keine PDF-Dateien gefunden.");
    return;
  }
  if (pdfs.length > MAX_FILES) {
    alert(`Bitte maximal ${MAX_FILES} PDFs auf einmal hochladen (ausgewählt: ${pdfs.length}). Es werden die ersten ${MAX_FILES} verarbeitet.`);
    pdfs.length = MAX_FILES;
  }
  if (processing) {
    alert("Es läuft bereits eine Verarbeitung. Bitte warten.");
    return;
  }

  processing = true;
  showProgress(0, pdfs.length);

  let done = 0;
  const queue = pdfs.slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const file = queue.shift();
      const result = await processFile(file);
      fileResults.push(result);
      done++;
      showProgress(done, pdfs.length);
    }
  });
  await Promise.all(workers);

  processing = false;
  $("progressSection").hidden = true;
  renderAll();
}

async function processFile(file) {
  const result = {
    name: file.name,
    status: "ok",
    message: "",
    date: null,
    monthKey: null,
    lines: [],
    items: [],
  };
  try {
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      lines.push(...buildLines(content.items));
      page.cleanup();
    }
    await doc.destroy();
    result.lines = lines;
    analyzeResult(result);
  } catch (err) {
    result.status = "err";
    result.message = "PDF konnte nicht gelesen werden: " + (err && err.message ? err.message : err);
  }
  return result;
}

/** Textfragmente anhand der Y-Koordinate zu Zeilen zusammensetzen. */
function buildLines(items) {
  const rows = [];
  const TOL = 2.5;
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const y = item.transform[5];
    const x = item.transform[4];
    let row = rows.find((r) => Math.abs(r.y - y) <= TOL);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, str: item.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) =>
    r.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str)
      .join(" ")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/* ---------- Analyse (Datum + Positionen) ---------- */

function compileRegex(input, errorEl, requiredGroup) {
  errorEl.hidden = true;
  try {
    const re = new RegExp(input.value, "i");
    if (!input.value.includes(`?<${requiredGroup}>`)) {
      throw new Error(`Die Gruppe (?<${requiredGroup}>…) fehlt im Muster.`);
    }
    return re;
  } catch (err) {
    errorEl.textContent = "Ungültiges Muster: " + err.message;
    errorEl.hidden = false;
    return null;
  }
}

function compileLineRegex() {
  return compileRegex(lineRegexInput, regexError, "artikel");
}

function analyzeResult(result) {
  if (result.status === "err") return;

  const found = findInvoiceDate(result.lines);
  result.date = found;
  result.monthKey = found
    ? `${found.getFullYear()}-${String(found.getMonth() + 1).padStart(2, "0")}`
    : null;

  result.items = [];
  if (currentMode() === "multiline") {
    const posRe = compileRegex(posLineRegexInput, posRegexError, "menge");
    const artRe = compileRegex(artLineRegexInput, artRegexError, "artikel");
    if (posRe && artRe) {
      result.items = parseMultilineItems(result.lines, posRe, artRe);
    }
  } else {
    const re = compileLineRegex();
    if (re) {
      const seen = new Set();
      for (const line of result.lines) {
        const m = re.exec(line);
        if (!m || !m.groups || !m.groups.artikel) continue;
        if (dedupeCheckbox.checked) {
          if (seen.has(line)) continue;
          seen.add(line);
        }
        const menge = m.groups.menge !== undefined ? parseGermanNumber(m.groups.menge) : 1;
        if (!isFinite(menge) || menge <= 0) continue;
        const bezeichnung = m.groups.bezeichnung ? cleanDescription(m.groups.bezeichnung) : "";
        result.items.push({ artikel: m.groups.artikel, bezeichnung, menge, line });
      }
    }
  }

  if (!result.monthKey && !result.items.length) {
    result.status = "warn";
    result.message = "Weder Datum noch Positionen erkannt.";
  } else if (!result.monthKey) {
    result.status = "warn";
    result.message = "Kein Rechnungsdatum erkannt – Positionen werden unter „Ohne Datum“ geführt.";
  } else if (!result.items.length) {
    result.status = "warn";
    result.message = "Keine Positionen erkannt – ggf. Zeilen-Muster anpassen (Details ansehen).";
  } else {
    result.status = "ok";
    result.message = "";
  }
}

/* Mehrzeiliger Modus: Menge aus der Positionszeile merken und mit der
   nächsten „Art. Nr.:“-Zeile verknüpfen. Positionen ohne Artikelnummer
   werden unter ihrer Bezeichnung gezählt. */
function parseMultilineItems(lines, posRe, artRe) {
  const items = [];
  let pending = null;
  const flush = () => {
    if (!pending) return;
    const desc = cleanDescription(pending.text);
    items.push({
      artikel: "(ohne Art.-Nr.) " + desc,
      bezeichnung: desc,
      menge: pending.menge,
      line: pending.line,
    });
    pending = null;
  };
  for (const line of lines) {
    const pm = posRe.exec(line);
    if (pm && pm.groups && pm.groups.menge !== undefined) {
      flush();
      const menge = parseGermanNumber(pm.groups.menge);
      if (isFinite(menge) && menge > 0) {
        pending = { menge, text: pm.groups.text || "", line };
      }
      continue;
    }
    const am = artRe.exec(line);
    if (am && am.groups && am.groups.artikel && pending) {
      items.push({
        artikel: am.groups.artikel.trim(),
        bezeichnung: cleanDescription(pending.text),
        menge: pending.menge,
        line: pending.line + "  →  " + line,
      });
      pending = null;
    }
  }
  flush();
  return items;
}

function cleanDescription(s) {
  return (
    String(s)
      .replace(/Zusatzrabatt.*$/i, "")
      .replace(/[\d.,]+\s*€.*$/, "")
      .replace(/\s+/g, " ")
      .replace(/^[\s.:\-–]+/, "")
      .replace(/[\s\-–]+$/, "")
      .trim()
      .slice(0, 80) || "(ohne Bezeichnung)"
  );
}

const DATE_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g;

function parseDateMatch(m) {
  let day, month, year;
  if (m[1] !== undefined) {
    day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
    if (year < 100) year += 2000;
  } else {
    year = Number(m[4]); month = Number(m[5]); day = Number(m[6]);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1990 || year > 2100) return null;
  return new Date(year, month - 1, day);
}

function findInvoiceDate(lines) {
  const keywords = dateKeywordsInput.value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // 1. Datum in einer Zeile mit Schlüsselwort (in Reihenfolge der Schlüsselwörter)
  for (const kw of keywords) {
    for (const line of lines) {
      if (!line.toLowerCase().includes(kw)) continue;
      DATE_RE.lastIndex = 0;
      let m;
      while ((m = DATE_RE.exec(line))) {
        const d = parseDateMatch(m);
        if (d) return d;
      }
    }
  }
  // 2. Erstes gültiges Datum im Dokument
  for (const line of lines) {
    DATE_RE.lastIndex = 0;
    let m;
    while ((m = DATE_RE.exec(line))) {
      const d = parseDateMatch(m);
      if (d) return d;
    }
  }
  return null;
}

function parseGermanNumber(s) {
  s = String(s).trim();
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  return parseFloat(s);
}

/** Bereits eingelesene PDFs mit den aktuellen Einstellungen neu auswerten (ohne erneutes Einlesen). */
function reanalyzeAll() {
  if (!fileResults.length) {
    if (currentMode() === "multiline") {
      compileRegex(posLineRegexInput, posRegexError, "menge");
      compileRegex(artLineRegexInput, artRegexError, "artikel");
    } else {
      compileLineRegex();
    }
    return;
  }
  for (const r of fileResults) analyzeResult(r);
  renderAll();
}

/* ---------- Aggregation & Darstellung ---------- */

const NO_DATE = "Ohne Datum";

function aggregate() {
  const months = new Set();
  const perArticle = new Map(); // artikel -> Map(monthKey -> summe)
  const descByArticle = new Map(); // artikel -> erste nicht-leere Bezeichnung
  for (const r of fileResults) {
    if (r.status === "err") continue;
    const key = r.monthKey || NO_DATE;
    for (const item of r.items) {
      months.add(key);
      let row = perArticle.get(item.artikel);
      if (!row) {
        row = new Map();
        perArticle.set(item.artikel, row);
      }
      row.set(key, (row.get(key) || 0) + item.menge);
      if (item.bezeichnung && !descByArticle.get(item.artikel)) {
        descByArticle.set(item.artikel, item.bezeichnung);
      }
    }
  }
  const monthKeys = Array.from(months).sort((a, b) => {
    if (a === NO_DATE) return 1;
    if (b === NO_DATE) return -1;
    return a.localeCompare(b);
  });
  const articles = Array.from(perArticle.keys()).sort((a, b) =>
    a.localeCompare(b, "de", { numeric: true })
  );
  return { monthKeys, articles, perArticle, descByArticle };
}

/* Produktgruppen-Konfiguration parsen: "Name = Regex" bzw. "Summe"-Zeilen. */
function parseGroupConfig() {
  groupConfigError.hidden = true;
  const defs = [];
  const errors = [];
  groupConfigInput.value.split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq < 0) {
      if (/^summe$/i.test(line)) {
        defs.push({ type: "sum", name: "Summe" });
      } else {
        errors.push(`Zeile ${idx + 1}: „${line}“ – erwartet „Name = Suchmuster“ oder „Summe“.`);
      }
      return;
    }
    const name = line.slice(0, eq).trim();
    const pattern = line.slice(eq + 1).trim();
    try {
      defs.push({ type: "group", name, re: new RegExp(pattern, "i") });
    } catch (err) {
      errors.push(`Zeile ${idx + 1} („${name}“): ungültiges Muster – ${err.message}`);
    }
  });
  if (errors.length) {
    groupConfigError.textContent = errors.join(" ");
    groupConfigError.hidden = false;
  }
  return defs;
}

function normalizeForGroups(s) {
  return String(s).normalize("NFC").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
}

/* Erste passende Gruppe für einen Text (für die Gruppen-Spalte in der Artikeltabelle). */
function groupNameFor(text, groups) {
  const g = groups.find((g) => g.re.test(normalizeForGroups(text)));
  return g ? g.name : "";
}

/* Summen pro Produktgruppe und Monat; pro Position zählt die erste passende Gruppe. */
function aggregateGroups() {
  const defs = parseGroupConfig();
  const groups = defs.filter((d) => d.type === "group");
  const sums = new Map(groups.map((g) => [g, new Map()]));
  for (const r of fileResults) {
    if (r.status === "err") continue;
    const key = r.monthKey || NO_DATE;
    for (const item of r.items) {
      const text = normalizeForGroups(item.bezeichnung || item.artikel || "");
      const g = groups.find((g) => g.re.test(text));
      if (!g) continue;
      const m = sums.get(g);
      m.set(key, (m.get(key) || 0) + item.menge);
    }
  }
  return { defs, sums };
}

const numFmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });

function monthLabel(key) {
  if (key === NO_DATE) return key;
  const [y, m] = key.split("-");
  return `${m}/${y}`;
}

function renderAll() {
  renderGroups();
  renderPivot();
  renderFiles();
}

function renderGroups() {
  const { monthKeys } = aggregate();
  const { defs, sums } = aggregateGroups();
  const section = $("groupSection");
  section.hidden = monthKeys.length === 0 || !defs.some((d) => d.type === "group");
  if (section.hidden) return;

  const table = $("groupTable");
  table.innerHTML = "";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.appendChild(th("Produktgruppe"));
  for (const mk of monthKeys) hr.appendChild(th(monthLabel(mk), "num"));
  hr.appendChild(th("Gesamt", "num total-col"));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  let blockTotals = new Map();
  for (const def of defs) {
    const tr = document.createElement("tr");
    if (def.type === "sum") {
      tr.className = "subtotal-row";
      tr.appendChild(td("Summe"));
      let total = 0;
      for (const mk of monthKeys) {
        const v = blockTotals.get(mk) || 0;
        total += v;
        tr.appendChild(td(numFmt.format(v), "num"));
      }
      tr.appendChild(td(numFmt.format(total), "num total-col"));
      blockTotals = new Map();
    } else {
      const row = sums.get(def);
      tr.appendChild(td(def.name));
      let total = 0;
      for (const mk of monthKeys) {
        const v = row.get(mk) || 0;
        total += v;
        blockTotals.set(mk, (blockTotals.get(mk) || 0) + v);
        tr.appendChild(td(v ? numFmt.format(v) : "–", "num"));
      }
      tr.appendChild(td(total ? numFmt.format(total) : "–", "num total-col"));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

function renderPivot() {
  const { monthKeys, articles, perArticle, descByArticle } = aggregate();
  const section = $("resultSection");
  section.hidden = articles.length === 0;
  if (!articles.length) return;

  const groups = parseGroupConfig().filter((d) => d.type === "group");
  const table = $("pivotTable");
  table.innerHTML = "";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.appendChild(th("Artikelnummer"));
  hr.appendChild(th("Bezeichnung"));
  hr.appendChild(th("Gruppe"));
  for (const mk of monthKeys) hr.appendChild(th(monthLabel(mk), "num"));
  hr.appendChild(th("Gesamt", "num total-col"));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const colTotals = new Map();
  let grandTotal = 0;

  for (const art of articles) {
    const row = perArticle.get(art);
    const tr = document.createElement("tr");
    tr.appendChild(td(art));
    tr.appendChild(td(descByArticle.get(art) || "", "desc"));
    tr.appendChild(td(groupNameFor(descByArticle.get(art) || art, groups) || "–"));
    let rowTotal = 0;
    for (const mk of monthKeys) {
      const v = row.get(mk) || 0;
      rowTotal += v;
      colTotals.set(mk, (colTotals.get(mk) || 0) + v);
      tr.appendChild(td(v ? numFmt.format(v) : "–", "num"));
    }
    grandTotal += rowTotal;
    tr.appendChild(td(numFmt.format(rowTotal), "num total-col"));
    tbody.appendChild(tr);
  }

  const totalTr = document.createElement("tr");
  totalTr.className = "total-row";
  totalTr.appendChild(td("Gesamt"));
  totalTr.appendChild(td(""));
  totalTr.appendChild(td(""));
  for (const mk of monthKeys) totalTr.appendChild(td(numFmt.format(colTotals.get(mk) || 0), "num"));
  totalTr.appendChild(td(numFmt.format(grandTotal), "num total-col"));
  tbody.appendChild(totalTr);

  table.appendChild(tbody);
}

function renderFiles() {
  const section = $("filesSection");
  section.hidden = fileResults.length === 0;
  if (!fileResults.length) return;

  const ok = fileResults.filter((r) => r.status === "ok").length;
  const warn = fileResults.filter((r) => r.status === "warn").length;
  const err = fileResults.filter((r) => r.status === "err").length;
  $("filesSummary").textContent =
    `${fileResults.length} Dateien – ${ok} ok, ${warn} mit Hinweis, ${err} fehlerhaft`;

  const tbody = $("filesTable").querySelector("tbody");
  tbody.innerHTML = "";
  fileResults.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.appendChild(td(r.name));
    tr.appendChild(td(r.date ? r.date.toLocaleDateString("de-DE") : "–"));
    tr.appendChild(td(r.monthKey ? monthLabel(r.monthKey) : "–"));
    tr.appendChild(td(String(r.items.length), "num"));
    const statusTd = td(
      r.status === "ok" ? "✓ OK" : r.status === "warn" ? "⚠ " + r.message : "✗ " + r.message
    );
    statusTd.className = r.status === "ok" ? "status-ok" : r.status === "warn" ? "status-warn" : "status-err";
    statusTd.style.whiteSpace = "normal";
    tr.appendChild(statusTd);

    const detailTd = document.createElement("td");
    if (r.status !== "err") {
      const btn = document.createElement("button");
      btn.className = "link-btn";
      btn.textContent = "Details";
      btn.addEventListener("click", () => showDetail(idx));
      detailTd.appendChild(btn);
    }
    tr.appendChild(detailTd);
    tbody.appendChild(tr);
  });
}

function showDetail(idx) {
  const r = fileResults[idx];
  $("detailTitle").textContent = r.name;
  const tbody = $("detailItems").querySelector("tbody");
  tbody.innerHTML = "";
  if (r.items.length) {
    for (const item of r.items) {
      const tr = document.createElement("tr");
      tr.appendChild(td(item.artikel));
      tr.appendChild(td(item.bezeichnung || "", "desc"));
      tr.appendChild(td(numFmt.format(item.menge), "num"));
      tr.appendChild(td(item.line));
      tbody.appendChild(tr);
    }
  } else {
    const tr = document.createElement("tr");
    const cell = td("Keine Positionen erkannt.");
    cell.colSpan = 4;
    tr.appendChild(cell);
    tbody.appendChild(tr);
  }
  $("detailText").textContent = r.lines.join("\n") || "(kein Text extrahierbar – evtl. gescanntes PDF ohne Textebene)";
  $("detailDialog").showModal();
}

/* ---------- CSV-Export ---------- */

function exportCsv() {
  const { monthKeys, articles, perArticle, descByArticle } = aggregate();
  if (!articles.length) return;

  const sep = ";";
  const rows = [];

  // Produktgruppen-Block (wie in der Anzeige oben)
  const { defs, sums } = aggregateGroups();
  const groups = defs.filter((d) => d.type === "group");
  if (groups.length) {
    rows.push(["Produktgruppe", "", "", ...monthKeys.map(monthLabel), "Gesamt"].join(sep));
    let blockTotals = new Map();
    for (const def of defs) {
      if (def.type === "sum") {
        let total = 0;
        const cells = monthKeys.map((mk) => {
          const v = blockTotals.get(mk) || 0;
          total += v;
          return csvNum(v);
        });
        rows.push(["Summe", "", "", ...cells, csvNum(total)].join(sep));
        blockTotals = new Map();
      } else {
        const row = sums.get(def);
        let total = 0;
        const cells = monthKeys.map((mk) => {
          const v = row.get(mk) || 0;
          total += v;
          blockTotals.set(mk, (blockTotals.get(mk) || 0) + v);
          return csvNum(v);
        });
        rows.push([csvCell(def.name), "", "", ...cells, csvNum(total)].join(sep));
      }
    }
    rows.push("");
  }

  rows.push(["Artikelnummer", "Bezeichnung", "Gruppe", ...monthKeys.map(monthLabel), "Gesamt"].join(sep));
  for (const art of articles) {
    const row = perArticle.get(art);
    let total = 0;
    const cells = monthKeys.map((mk) => {
      const v = row.get(mk) || 0;
      total += v;
      return csvNum(v);
    });
    rows.push([
      csvCell(art),
      csvCell(descByArticle.get(art) || ""),
      csvCell(groupNameFor(descByArticle.get(art) || art, groups)),
      ...cells,
      csvNum(total),
    ].join(sep));
  }

  const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "artikel-pro-monat.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvNum(v) {
  return String(v).replace(".", ",");
}
function csvCell(s) {
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* ---------- Helfer ---------- */

function th(text, cls) {
  const el = document.createElement("th");
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function td(text, cls) {
  const el = document.createElement("td");
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function showProgress(done, total) {
  $("progressSection").hidden = false;
  $("progressLabel").textContent = "Verarbeite PDFs …";
  $("progressCount").textContent = `${done} / ${total}`;
  $("progressFill").style.width = total ? (done / total) * 100 + "%" : "0";
}
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
