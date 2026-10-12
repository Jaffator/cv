/* Prints index.html to Jaroslav_Lufinka_CV.pdf with headless Chrome or Edge.
   Usage: node build-pdf.js   (set CHROME_PATH if the browser is somewhere else)
   The Pages workflow runs this on every push, so the published PDF always matches the page. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const browser = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!browser) throw new Error('Chrome or Edge not found, set CHROME_PATH');

const out = path.join(__dirname, 'Jaroslav_Lufinka_CV.pdf');
fs.rmSync(out, { force: true }); // a failed print must not leave the old PDF behind looking fresh
execFileSync(browser, [
  '--headless=new',
  '--disable-gpu',
  // GitHub's Ubuntu runners have no usable Chrome sandbox, and Linux font hinting
  // would shift text widths (and line breaks) away from the Windows build
  ...(process.env.CI ? ['--no-sandbox', '--font-render-hinting=none'] : []),
  '--no-pdf-header-footer',
  '--virtual-time-budget=8000',
  `--print-to-pdf=${out}`,
  pathToFileURL(path.join(__dirname, 'index.html')).href,
], { stdio: 'ignore' });
if (!fs.existsSync(out)) throw new Error('Chrome did not write the PDF');
console.log('built', out, fs.statSync(out).size, 'bytes');
