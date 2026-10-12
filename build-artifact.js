/* Builds dist/ for publishing as a claude.ai Artifact.
   The artifact host wraps the page in its own <html><head><body> skeleton,
   so the published page is the <head> extras + <body> content only.
   Usage: node build-artifact.js [outDir] */
const fs = require('fs');
const path = require('path');

const src = __dirname;
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(src, 'dist');
fs.mkdirSync(out, { recursive: true });

const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];

const title = head.match(/<title>[\s\S]*?<\/title>/i)[0];
const links = head.match(/<link[^>]*>/gi).join('\n');
const style = head.match(/<style[^>]*>[\s\S]*?<\/style>/i)[0];

const page = `${title}\n${links}\n${style}\n${body.trim()}\n`;
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.cpSync(path.join(src, 'assets'), path.join(out, 'assets'), { recursive: true });
console.log('built', out, page.length, 'bytes');
