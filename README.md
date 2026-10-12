# CV

My résumé as a single HTML page, laid out for A4, edited and exported to PDF right in the browser.

Lives as a claude.ai artifact: https://claude.ai/artifact/H2daotLYMVCrM8ntF5LRT6

- `index.html` – the page. Drawn at 940 × 1329 px and scaled to 210 mm for print.
- `assets/` – photo, company logos and the static TTFs the PDF embeds (Rubik 400/500, Inter 400/700).

## Editing

**Upravit** makes every text field editable in place. In the artifact, **Uložit** publishes the
edited page as a new version of the artifact; **Zrušit** throws the changes away. Opened from disk
or a web server, **Hotovo** only keeps the changes on screen (for a one-off PDF export).

## Export to PDF

**Export do PDF** redraws the rendered sheet as vector text with jsPDF (cdnjs), using the same
line breaks and fonts Chrome shows on screen. Inside the artifact the file goes through the
artifact's download prompt, because an artifact page cannot start a download itself.

Backup route without the button: Ctrl+P in Chrome, margins *None*, *Background graphics* on, or

```bash
node build-pdf.js
```

## Preview

```bash
python -m http.server 5187
```

## Publishing the artifact

```bash
node build-artifact.js [outDir]
```

Writes the page without its `<html>/<head>/<body>` wrapper plus `assets/` to `dist/` (or `outDir`);
publish that `index.html` with the assets as files to the artifact URL.
