# CV

My résumé as a single HTML page, laid out for A4 and exported to PDF.

- `index.html` – the page. Drawn at 940 × 1329 px and scaled to 210 mm in print.
- `assets/` – photo and company logos.
- `Jaroslav_Lufinka_CV.pdf` – the exported PDF.

## Export to PDF

```bash
node build-pdf.js
```

Prints `index.html` with headless Chrome or Edge (set `CHROME_PATH` if neither is in the default location).

By hand: open `index.html` in Chrome, click **Export do PDF** (or Ctrl+P), set margins to *None* and turn on *Background graphics*.

## Preview

```bash
python -m http.server 5187
```

## Claude artifact

```bash
node build-pdf.js
node build-artifact.js [outDir]
```

Writes the page without its `<html>/<head>/<body>` wrapper plus the assets and the PDF to `dist/` (or `outDir`). Inside the artifact the export button hands over the prebuilt PDF, because artifacts cannot open the print dialog.
