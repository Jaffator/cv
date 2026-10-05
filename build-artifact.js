/* Builds dist/ for publishing as a claude.ai Artifact.
   The artifact host wraps the page in its own <html><head><body> skeleton,
   so the published page is the <head> extras + <body> content only.
   Run build-pdf.js first: the artifact's export button hands over that PDF.
   Usage: node build-artifact.js [outDir] */
const fs = require('fs');
const path = require('path');

const src = __dirname;
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(src, 'dist');
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];

const title = head.match(/<title>[\s\S]*?<\/title>/i)[0];
const links = head.match(/<link[^>]*>/gi).join('\n');
const style = head.match(/<style>[\s\S]*?<\/style>/i)[0];

const page = `${title}\n${links}\n${style}\n${body.trim()}\n`;
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.copyFileSync(path.join(src, 'Jaroslav_Lufinka_CV.pdf'), path.join(out, 'Jaroslav_Lufinka_CV.pdf'));
for (const f of fs.readdirSync(path.join(src, 'assets'))) fs.copyFileSync(path.join(src, 'assets', f), path.join(out, 'assets', f));
console.log('built', out, page.length, 'bytes');
