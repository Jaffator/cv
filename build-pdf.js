/* Prints index.html to Jaroslav_Lufinka_CV.pdf with headless Chrome or Edge.
   Usage: node build-pdf.js   (set CHROME_PATH if the browser is somewhere else) */
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
execFileSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-pdf-header-footer',
  '--virtual-time-budget=8000',
  `--print-to-pdf=${out}`,
  pathToFileURL(path.join(__dirname, 'index.html')).href,
], { stdio: 'ignore' });
console.log('built', out, fs.statSync(out).size, 'bytes');
