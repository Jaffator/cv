# CV

My résumé as a single HTML page, laid out for A4 and exported to PDF.

Live: https://jaffator.github.io/cv/ · [PDF](https://jaffator.github.io/cv/Jaroslav_Lufinka_CV.pdf)

- `index.html` – the page. Drawn at 940 × 1329 px and scaled to 210 mm in print.
- `editor.js`, `editor.css` – editing right on the published page, for the owner only.
- `assets/` – photo and company logos.
- `.github/workflows/pages.yml` – builds the PDF and publishes the site on every push to `main`.

## Editing on the web

Open https://jaffator.github.io/cv/#edit and sign in with a GitHub token (below). Then click into any text and type:

- Enter adds a bullet in a bullet list and a line break in a paragraph; Ctrl+B is bold.
- The small toolbar above the item, contact or section title under the pointer moves, duplicates and deletes it; on a job it also changes or removes the logo.
- Clicking the photo or a logo (or dropping a file on it) replaces it. Pictures are scaled down in the browser before upload.
- A contact's link follows its text: an e-mail, a phone number or a web address.
- The bar on top shows how much room is left on the A4 page; if something no longer fits, a red line marks where the PDF would cut it off.

**Uložit** (Ctrl+S) commits `index.html` and any new pictures to `main`. The Pages workflow then rebuilds the PDF and redeploys; the bar says when the new version is live, usually within two minutes. Every save is a commit, so the history and reverting live on GitHub.

A browser that has signed in shows **Upravit** next to the export button on every visit; **Odhlásit** forgets the token.

### The token

[Create a fine-grained token](https://github.com/settings/personal-access-tokens/new?name=CV+editor&target_name=Jaffator&expires_in=366&contents=write) (the link pre-fills it): under *Repository access* choose *Only select repositories* → `cv`; *Contents: Read and write* is already set. Paste it as the password in the sign-in dialog; the browser can save it like any password. When it expires, make a new one the same way.

The token never leaves the browser except to api.github.com. Nobody without such a token can change anything: the page only prepares the commit, GitHub decides who may write. It is kept in `localStorage` (or only for the tab if *Zapamatovat* is off), which every page on jaffator.github.io can read, since they share one origin.

### How saving works

The editor rewrites only the part of `index.html` between `<!-- sheet:start` and `<!-- sheet:end -->`, and an untouched sheet saves byte for byte, so styles and scripts can still be edited by hand. If the sheet changed somewhere else since the editor loaded it (a push from the laptop, say), saving stops and offers to overwrite that change or load the newer version.

## Export to PDF

```bash
node build-pdf.js
```

Prints `index.html` with headless Chrome or Edge (set `CHROME_PATH` if neither is in the default location). The Pages workflow runs the same script on every push, so the published PDF always matches the page and the PDF is not kept in git.

The **Export do PDF** button on the page downloads the published PDF.

By hand: open `index.html` in Chrome, press Ctrl+P, set margins to *None* and turn on *Background graphics*.

## Preview

```bash
python -m http.server 5187
```

## Claude artifact

```bash
node build-pdf.js
node build-artifact.js [outDir]
```

Writes the page without its `<html>/<head>/<body>` wrapper plus the assets and the PDF to `dist/` (or `outDir`). Inside the artifact the export button hands the PDF over through the artifact's download prompt, because an artifact page cannot start a download itself. The web editor does not run there.
