// Baut PDF-Auswertung.html: alle Skripte und Styles in eine einzige Datei eingebettet,
// damit die Seite als einzelne heruntergeladene Datei per Doppelklick funktioniert.
// Aufruf: node tools/build-standalone.mjs
import { readFileSync, writeFileSync } from "fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

const inline = (code) => {
  if (code.includes("</script")) {
    throw new Error("Quelldatei enthält '</script' – Escaping nötig.");
  }
  return code;
};

let html = read("index.html");
html = html.replace(
  '<link rel="stylesheet" href="styles.css">',
  () => "<style>\n" + read("styles.css") + "</style>"
);
for (const src of ["vendor/pdf.min.js", "vendor/pdf.worker.min.js", "app.js"]) {
  html = html.replace(
    `<script src="${src}"></script>`,
    () => "<script>\n" + inline(read(src)) + "\n</script>"
  );
}
if (/(src=|href=)"(?!data:)/.test(html.replace(/<meta[^>]*>/g, ""))) {
  console.warn("Hinweis: Es sind noch externe Verweise enthalten.");
}

writeFileSync(new URL("../PDF-Auswertung.html", import.meta.url), html);
console.log("PDF-Auswertung.html erzeugt.");
