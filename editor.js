/* Owner-only editing of the CV, right on the published page.
   Open https://jaffator.github.io/cv/#edit and sign in with a fine-grained GitHub token that may
   write to Jaffator/cv (Contents: Read and write). Saving commits index.html, plus any new picture,
   to main; the Pages workflow then rebuilds the PDF and redeploys the site.
   The token stays in this browser and is only ever sent to api.github.com. */
(function () {
  'use strict';

  var REPO = 'Jaffator/cv';
  var BRANCH = 'main';
  var API = 'https://api.github.com/';
  var R = 'repos/' + REPO + '/';
  var SITE = 'https://jaffator.github.io/cv/';
  var TOKEN_KEY = 'cv-editor-token';
  var USER_KEY = 'cv-editor-user';
  var START = '<!-- sheet:start';
  var END = '<!-- sheet:end -->';
  var NEW_TOKEN = 'https://github.com/settings/personal-access-tokens/new?name=CV+editor&description='
    + encodeURIComponent('Úpravy CV na jaffator.github.io/cv') + '&target_name=Jaffator&expires_in=366&contents=write';
  var A4 = 1329; // sheet height in px, anything lower is cut off in the PDF

  // Editable text in the sheet, grouped by what Enter does there
  var LINE = '.name, .role, .contact span, .section-title, .h, .school, .date, .org, .name-l, .level'; // nothing
  var TEXT = '.item > p'; // line break
  var LIST = '.bullets'; // new bullet
  var FIELDS = LINE + ', ' + TEXT + ', ' + LIST;
  var REMOVED = { contact: 'Kontakt smazán.', item: 'Položka smazána.', section: 'Sekce smazána.' };

  var ICONS = {
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    remove: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    logo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    unlogo: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M5 6l14 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };

  var token = stored(TOKEN_KEY);
  var user = stored(USER_KEY);
  var base = null; // { commit, blob, source } of the index.html being edited
  var saved = ''; // the sheet as last loaded or saved, to tell unsaved changes
  var uploads = {}; // repo path -> base64 of a picture that is not committed yet
  var editing = false;
  var busy = false;
  var watching = null;
  var picking = null;
  var cleanText = '';
  var cleanTone = '';
  var timer = 0;
  var ui = {};

  /* ---------- storage and GitHub ---------- */

  function stored(key) {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key); } catch (e) { return null; }
  }
  function remember(value, login, persist) {
    forget();
    try {
      var store = persist ? localStorage : sessionStorage;
      store.setItem(TOKEN_KEY, value);
      store.setItem(USER_KEY, login);
    } catch (e) { /* no storage: signed in for this visit only */ }
  }
  function forget() {
    try {
      [localStorage, sessionStorage].forEach(function (s) { s.removeItem(TOKEN_KEY); s.removeItem(USER_KEY); });
    } catch (e) { /* nothing stored */ }
  }

  async function gh(path, body, method) {
    var res;
    try {
      res = await fetch(API + path, {
        method: method || (body ? 'POST' : 'GET'),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store' // the API allows a minute of caching, a stale branch head would look like a conflict
      });
    } catch (e) {
      throw failure(0, 'GitHub není dostupný, zkontroluj připojení.');
    }
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) throw failure(res.status, (data && data.message) || 'HTTP ' + res.status);
    return data;
  }
  function failure(status, message) {
    var err = new Error(message);
    err.status = status;
    return err;
  }
  function explain(err) {
    if (err.status === 401) return 'Token neplatí (vypršel nebo byl smazán). Přihlas se znovu.';
    if (err.status === 403 && /rate limit/i.test(err.message)) return 'GitHub teď odmítá další požadavky, zkus to za pár minut.';
    if (err.status === 403 || err.status === 404) {
      return 'Token nemá právo zapisovat do ' + REPO + '. Vytvoř ho s přístupem k repozitáři cv a oprávněním Contents: Read and write.';
    }
    return err.message || String(err);
  }

  function fromBase64(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function toBase64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function latest() {
    var ref = await gh(R + 'git/ref/heads/' + BRANCH);
    return fileAt(ref.object.sha);
  }
  async function fileAt(commit) {
    var file = await gh(R + 'contents/index.html?ref=' + commit);
    return { commit: commit, blob: file.sha, source: fromBase64(file.content) };
  }

  /* ---------- the sheet as HTML ---------- */

  function sheet() { return document.querySelector('.page'); }

  function bounds(source) {
    var a = source.indexOf(START);
    var b = source.indexOf(END);
    if (a < 0 || b < a) throw new Error('V index.html chybí značky sheet:start a sheet:end.');
    return { from: source.indexOf('-->', a) + 3, to: b };
  }
  function sheetSource(source) {
    var r = bounds(source);
    return source.slice(r.from, r.to).trim();
  }
  function splice(source, html) {
    var r = bounds(source);
    return source.slice(0, r.from) + '\n' + html + '\n' + source.slice(r.to);
  }
  function parse(html) {
    var page = new DOMParser().parseFromString(html, 'text/html').querySelector('.page');
    if (!page) throw new Error('V index.html chybí list (.page).');
    return document.importNode(page, true);
  }

  // The sheet as it gets saved: without the editor's additions, new pictures under their repo paths,
  // and <path …/> written the way index.html has it, so an untouched sheet saves byte for byte.
  function serialize(page) {
    var copy = page.cloneNode(true);
    copy.querySelectorAll('.cv-ui').forEach(function (el) { el.remove(); });
    copy.querySelectorAll('img[data-cv-src]').forEach(function (img) {
      img.setAttribute('src', img.getAttribute('data-cv-src'));
      img.removeAttribute('data-cv-src');
    });
    copy.querySelectorAll('[contenteditable]').forEach(function (el) { el.removeAttribute('contenteditable'); });
    [copy].concat(Array.from(copy.querySelectorAll('[class]'))).forEach(function (el) {
      var mine = Array.from(el.classList).filter(function (c) { return c.indexOf('cv-') === 0; });
      if (!mine.length) return;
      mine.forEach(function (c) { el.classList.remove(c); });
      if (!el.classList.length) el.removeAttribute('class');
    });
    copy.querySelectorAll(FIELDS).forEach(tidy);
    return copy.outerHTML.replace(/<(path|use|circle|rect|line|polyline|polygon|ellipse)\b([^>]*)><\/\1>/g, '<$1$2/>');
  }

  // Put a version of the sheet on the page, unless it is what is already there.
  function show(html) {
    var fresh = parse(html);
    if (serialize(fresh) === serialize(sheet())) return false;
    hideTools();
    sheet().replaceWith(fresh);
    return true;
  }

  // Undo what contenteditable leaves behind: pasted styling, &nbsp;, stray tags, the caret's <br>.
  function tidy(field) {
    if (!field.matches(LIST)) { clean(field, field.matches(TEXT)); return; }
    var group = null;
    Array.from(field.childNodes).forEach(function (n) {
      if (n.nodeName === 'LI') { group = null; return; }
      if (!group && n.nodeType === 3 && !n.nodeValue.trim()) return; // indentation between bullets
      var block = n.nodeName === 'DIV' || n.nodeName === 'P';
      if (!group || block) { group = document.createElement('li'); field.insertBefore(group, n); }
      group.appendChild(n);
      if (block) group = null;
    });
    Array.from(field.children).forEach(function (li) {
      clean(li, true);
      if (!li.textContent.trim()) cut(li);
    });
    // Every bullet on its own line, indented one step deeper than the list, as index.html is written
    var outer = spaceBefore(field);
    if (!outer || !field.children.length) return;
    field.normalize();
    var close = '\n' + outer.nodeValue.split('\n').pop();
    Array.from(field.children).forEach(function (li) {
      var space = spaceBefore(li);
      if (space) space.nodeValue = close + '  ';
      else field.insertBefore(document.createTextNode(close + '  '), li);
    });
    var end = field.lastChild;
    if (end.nodeType === 3 && !end.nodeValue.trim()) end.nodeValue = close;
    else field.appendChild(document.createTextNode(close));
  }
  function clean(el, lines) {
    Array.from(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        if (n.nodeValue.indexOf('\u00a0') > -1) n.nodeValue = n.nodeValue.replace(/\u00a0/g, ' ');
        return;
      }
      if (n.nodeType !== 1) { n.remove(); return; }
      clean(n, lines);
      if (n.nodeName === 'BR') {
        if (!lines) n.replaceWith(' ');
        return;
      }
      if (/^(B|STRONG|I|EM|A)$/.test(n.nodeName)) {
        Array.from(n.attributes).forEach(function (a) {
          if (n.nodeName !== 'A' || !/^(href|target|rel)$/.test(a.name)) n.removeAttribute(a.name);
        });
        if (!n.textContent && n.nodeName !== 'A') n.remove();
        return;
      }
      // Anything else (span, font, a pasted picture…) keeps only its text; a block starts a new line
      if (lines && /^(DIV|P|LI)$/.test(n.nodeName) && n.previousSibling) n.before(document.createElement('br'));
      n.replaceWith.apply(n, Array.from(n.childNodes));
    });
    var last;
    while ((last = el.lastChild) && (last.nodeName === 'BR'
      || (last.nodeType === 3 && !last.nodeValue.trim() && last.previousSibling && last.previousSibling.nodeName === 'BR'))) {
      last.remove();
    }
  }

  // Indentation before an element, so moved and copied blocks keep index.html readable
  function spaceBefore(el) {
    var n = el && el.previousSibling;
    return n && n.nodeType === 3 && !n.nodeValue.trim() ? n : null;
  }
  // Take an element out together with its indentation; returns a function that puts it back
  function cut(el) {
    var parent = el.parentNode;
    var next = el.nextSibling;
    var space = spaceBefore(el);
    if (space) space.remove();
    el.remove();
    return function () {
      parent.insertBefore(el, next && next.parentNode === parent ? next : null);
      if (space) parent.insertBefore(space, el);
    };
  }

  /* ---------- editing mode ---------- */

  async function enter() {
    if (editing || busy) return;
    if (!token) { openLogin(); return; }
    busy = true;
    update();
    try {
      base = await latest();
      show(sheetSource(base.source));
      startEditing();
    } catch (err) {
      if (err.status === 401) {
        signOut();
        openLogin('Token už neplatí (vypršel nebo byl smazán). Zadej nový.');
      } else {
        toast('Úpravy se nepodařilo otevřít: ' + explain(err));
      }
    } finally {
      busy = false;
      update();
    }
  }

  function startEditing() {
    editing = true;
    document.documentElement.classList.add('cv-editing');
    sheet().querySelectorAll(FIELDS).forEach(function (el) { el.setAttribute('contenteditable', 'true'); });
    decorate();
    saved = serialize(sheet());
    cleanText = 'Bez změn';
    cleanTone = '';
    if (location.hash !== '#edit') history.replaceState(null, '', '#edit');
    refresh();
    if (document.fonts) document.fonts.ready.then(refresh);
  }

  function stopEditing() {
    editing = false;
    watching = null;
    hideTools();
    var page = sheet();
    page.querySelectorAll('.cv-ui').forEach(function (el) { el.remove(); });
    page.querySelectorAll(FIELDS).forEach(function (el) { tidy(el); el.removeAttribute('contenteditable'); });
    page.classList.remove('cv-overflow');
    document.documentElement.classList.remove('cv-editing');
    if (location.hash === '#edit') history.replaceState(null, '', location.pathname + location.search);
    update();
  }

  function discard() {
    sheet().replaceWith(parse(saved));
    uploads = {};
  }

  function close() {
    if (dirty()) {
      if (!confirm('Zahodit neuložené změny?')) return;
      hideTools();
      discard();
    }
    stopEditing();
  }

  function signOut() {
    if (editing) {
      if (dirty() && !confirm('Odhlásit se a zahodit neuložené změny?')) return;
      if (dirty()) { hideTools(); discard(); }
      stopEditing();
    }
    token = null;
    user = null;
    forget();
    update();
  }

  function dirty() { return editing && serialize(sheet()) !== saved; }

  // Editor-only helpers inside the sheet (removed again by serialize): empty logo spots,
  // a bullet to type into in an emptied list, and the red line where A4 ends.
  function decorate() {
    var page = sheet();
    page.querySelectorAll('.job').forEach(function (job) {
      var logo = job.querySelector(':scope > .logo');
      var slot = job.querySelector(':scope > .cv-logo-slot');
      if (logo && slot) slot.remove();
      if (!logo && !slot) {
        slot = button('cv-ui cv-logo-slot', 'Přidat logo', 'plus', 'add-logo');
        job.prepend(slot);
      }
    });
    page.querySelectorAll('.bullets').forEach(function (ul) {
      if (!ul.querySelector('li')) ul.appendChild(document.createElement('li'));
    });
    if (!page.querySelector(':scope > .cv-a4')) {
      var line = document.createElement('div');
      line.className = 'cv-ui cv-a4';
      line.innerHTML = '<span>Konec strany A4 · níž už se do PDF nevejde</span>';
      page.appendChild(line);
    }
  }

  function changed() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  }

  function refresh() {
    if (!editing) return;
    var isDirty = dirty();
    status(isDirty ? 'Neuložené změny' : cleanText, isDirty ? '' : cleanTone);
    measure();
    update(isDirty);
    if (ui.block && !ui.block.isConnected) hideTools();
    else if (ui.block) activate(ui.block, true);
  }

  // How much room is left in each column above the end of the A4 page
  function measure() {
    var page = sheet();
    var box = page.getBoundingClientRect();
    var zoom = box.width / 940 || 1;
    var free = ['.side', '.main'].map(function (sel) {
      var col = page.querySelector(sel);
      var last = col && col.lastElementChild;
      return last ? Math.floor(A4 - (last.getBoundingClientRect().bottom - box.top) / zoom) : A4;
    });
    var over = Math.min(free[0], free[1]) < 0;
    page.classList.toggle('cv-overflow', over);
    ui.fit.classList.toggle('cv-bad', over);
    if (!over) {
      ui.fit.textContent = 'Volno: vlevo ' + free[0] + ' px, vpravo ' + free[1] + ' px';
    } else if (free[0] < 0 && free[1] < 0) {
      ui.fit.textContent = 'Oba sloupce přetékají (o ' + -free[0] + ' a ' + -free[1] + ' px), v PDF se konec usekne';
    } else {
      var left = free[0] < 0;
      ui.fit.textContent = (left ? 'Levý' : 'Pravý') + ' sloupec přetéká o ' + -(left ? free[0] : free[1]) + ' px, v PDF se konec usekne';
    }
  }

  /* ---------- typing ---------- */

  function fieldOf(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    el = el && el.closest('[contenteditable="true"]');
    return el && el.closest('.page') ? el : null;
  }

  function onBeforeInput(e) {
    var field = editing && fieldOf(e.target);
    if (!field) return;
    var type = e.inputType;
    var list = field.matches(LIST);
    var text = field.matches(TEXT);
    if ((type === 'insertParagraph' && !list) || (type === 'insertLineBreak' && !list && !text)) {
      e.preventDefault();
      if (type === 'insertParagraph' && text) lineBreak();
    } else if (/^format/.test(type) && !/^format(Bold|Italic)$/.test(type)) {
      e.preventDefault(); // bold and italic only, nothing else would survive saving anyway
    }
  }

  function lineBreak() {
    if (document.queryCommandSupported('insertLineBreak') && document.execCommand('insertLineBreak')) return;
    var sel = getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Paste plain text only; line breaks become bullets, new lines or spaces depending on the field
  function onPaste(e) {
    var field = editing && fieldOf(e.target);
    if (!field) return;
    e.preventDefault();
    var text = (e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    var list = field.matches(LIST);
    if (!list && !field.matches(TEXT)) text = text.replace(/\s*\n\s*/g, ' ');
    text.split('\n').forEach(function (line, i) {
      if (i) {
        if (list) document.execCommand('insertParagraph');
        else lineBreak();
      }
      if (line) document.execCommand('insertText', false, line);
    });
  }

  function onInput(e) {
    var field = editing && fieldOf(e.target);
    if (!field) return;
    if (field.matches('.contact span')) linkContact(field.closest('.contact'));
    if (field.matches('.org')) linkOrg(field);
    if (field.innerHTML === '<br>') field.innerHTML = ''; // emptied: show the placeholder
    changed();
  }

  function onFocusOut(e) {
    var field = editing && fieldOf(e.target);
    if (!field || field.contains(e.relatedTarget)) return;
    tidy(field);
    decorate();
    changed();
  }

  // A contact's link follows its text: e-mail, phone number or web address, icon included
  function linkContact(a) {
    var text = a.querySelector('span').textContent.trim();
    var kind = 'link';
    var href = /^https?:\/\//i.test(text) ? text : 'https://' + text;
    if (/^[^\s@]+@[^\s@]+$/.test(text)) { kind = 'mail'; href = 'mailto:' + text; }
    else if (/^\+?[\d\s()./-]{6,}$/.test(text)) { kind = 'phone'; href = 'tel:' + text.replace(/[^\d+]/g, ''); }
    a.setAttribute('href', href);
    var use = a.querySelector('use');
    if (use) use.setAttribute('href', '#i-' + kind);
  }
  function linkOrg(org) {
    var a = org.querySelector('a');
    var text = org.textContent.trim();
    if (a && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text)) a.setAttribute('href', 'https://' + text.toLowerCase());
  }

  /* ---------- blocks: move, duplicate, delete ---------- */

  function kindOf(block) {
    if (block.classList.contains('contact')) return 'contact';
    return block.classList.contains('item') ? 'item' : 'section';
  }

  function blockAt(node) {
    var el = node && node.closest && node.closest('.cv-tools, .contact, .item, .section-title');
    if (!el || !el.closest('.page') || el.classList.contains('cv-tools')) return null;
    return el.classList.contains('section-title') ? el.parentElement : el;
  }

  function neighbour(block, dir) {
    var el = block;
    do { el = dir < 0 ? el.previousElementSibling : el.nextElementSibling; } while (el && el.classList.contains('cv-ui'));
    return el && el.classList.contains(kindOf(block)) ? el : null;
  }

  function activate(block, force) {
    if (!force && ui.block === block && ui.tools.parentNode === block) return;
    if (ui.block && ui.block !== block) ui.block.classList.remove('cv-active');
    ui.block = block;
    block.classList.add('cv-active');
    if (ui.tools.parentNode !== block) block.appendChild(ui.tools);
    var job = block.classList.contains('job');
    var logo = job && block.querySelector(':scope > .logo');
    ui.tools.querySelector('[data-act="up"]').disabled = !neighbour(block, -1);
    ui.tools.querySelector('[data-act="down"]').disabled = !neighbour(block, 1);
    ui.tools.querySelector('hr').hidden = !job;
    ui.tools.querySelector('[data-act="logo"]').hidden = !job;
    ui.tools.querySelector('[data-act="unlogo"]').hidden = !logo;
  }

  function hideTools() {
    if (ui.block) ui.block.classList.remove('cv-active');
    ui.block = null;
    if (ui.tools) ui.tools.remove();
  }

  function act(name, el) {
    var block = el.classList.contains('cv-logo-slot') ? el.closest('.job') : ui.block;
    if (!block) return;
    if (name === 'up' || name === 'down') {
      var other = neighbour(block, name === 'up' ? -1 : 1);
      if (other) swap(block, other);
      activate(block, true);
      var again = ui.tools.querySelector('[data-act="' + name + '"]');
      (again.disabled ? ui.tools.querySelector('[data-act="' + (name === 'up' ? 'down' : 'up') + '"]') : again).focus();
    } else if (name === 'copy') {
      duplicate(block);
    } else if (name === 'remove') {
      var what = kindOf(block);
      hideTools();
      var undo = cut(block);
      toast(REMOVED[what], 'Vrátit', function () { undo(); decorate(); changed(); });
    } else if (name === 'logo' || name === 'add-logo') {
      pick({ kind: 'logo', job: block, img: block.querySelector(':scope > .logo') });
      return;
    } else if (name === 'unlogo') {
      var logo = block.querySelector(':scope > .logo');
      if (logo) cut(logo);
      decorate();
      activate(block, true);
    }
    changed();
  }

  // Swap two siblings in place, so each keeps the indentation around it
  function swap(a, b) {
    var mark = document.createComment('');
    a.replaceWith(mark);
    b.replaceWith(a);
    mark.replaceWith(b);
  }

  function duplicate(block) {
    var copy = block.cloneNode(true);
    copy.querySelectorAll('.cv-tools').forEach(function (el) { el.remove(); });
    copy.classList.remove('cv-active');
    var space = spaceBefore(block);
    block.after(copy);
    if (space) copy.before(space.cloneNode());
    activate(copy);
    var first = copy.querySelector('[contenteditable="true"]');
    if (first) caretAtEnd(first);
  }

  function caretAtEnd(el) {
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ---------- pictures ---------- */

  function pick(target) {
    picking = target;
    ui.file.value = '';
    ui.file.click();
  }

  function targetOf(el) {
    if (el.classList.contains('photo')) return { kind: 'photo', img: el };
    var job = el.closest('.job');
    return { kind: 'logo', job: job, img: job.querySelector(':scope > .logo') };
  }

  async function useFile(file, target) {
    if (!file || !target) return;
    try {
      var out = await shrink(file, target.kind);
      var bytes = new Uint8Array(await out.blob.arrayBuffer());
      var path = 'assets/' + target.kind + '-' + (await digest(bytes)) + '.' + out.ext;
      uploads[path] = toBase64(bytes);
      var img = target.img;
      if (!img) { // first logo of this job, placed where the other jobs have theirs
        img = document.createElement('img');
        img.className = 'logo';
        img.setAttribute('src', '');
        img.setAttribute('alt', '');
        var row = target.job.querySelector(':scope > .row');
        var space = spaceBefore(row);
        target.job.insertBefore(img, row);
        if (space) target.job.insertBefore(space.cloneNode(), row);
      }
      img.src = URL.createObjectURL(out.blob);
      img.setAttribute('data-cv-src', path);
      decorate();
      if (target.job) activate(target.job, true);
      changed();
    } catch (err) {
      toast('Obrázek se nepodařilo použít: ' + (err.message || err));
    }
  }

  // 4x the printed size is plenty: the photo is a 116 px circle, a logo a 40 px box
  async function shrink(file, kind) {
    if (file.type === 'image/svg+xml') return { blob: file, ext: 'svg' };
    if (!/^image\//.test(file.type)) throw new Error('není to obrázek');
    var bitmap = await createImageBitmap(file);
    var scale = kind === 'photo'
      ? Math.min(1, 464 / Math.min(bitmap.width, bitmap.height))
      : Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    var jpeg = kind === 'photo' || file.type === 'image/jpeg';
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, jpeg ? 'image/jpeg' : 'image/png', 0.9); });
    if (!blob) throw new Error('převod se nepovedl');
    return { blob: blob, ext: jpeg ? 'jpg' : 'png' };
  }

  async function digest(bytes) {
    var hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(hash.slice(0, 4), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  /* ---------- saving ---------- */

  async function save(force) {
    if (busy || !editing) return;
    var html = serialize(sheet());
    if (html === saved && !force) return;
    busy = true;
    update();
    status('Ukládám…');
    try {
      var head = (await gh(R + 'git/ref/heads/' + BRANCH)).object.sha;
      var now = head === base.commit ? base : await fileAt(head);
      // Changes elsewhere in the repo, or outside the sheet, are fine: the sheet goes into the newest index.html
      if (!force && now.blob !== base.blob && sheetSource(now.source) !== sheetSource(base.source)) {
        throw failure('conflict', 'Životopis se mezitím změnil jinde (třeba push z počítače).');
      }
      var source = splice(now.source, html);
      var parent = await gh(R + 'git/commits/' + head);
      var page = await gh(R + 'git/blobs', { content: source, encoding: 'utf-8' });
      var files = [{ path: 'index.html', mode: '100644', type: 'blob', sha: page.sha }];
      var paths = Object.keys(uploads).filter(function (path) { return source.indexOf('"' + path + '"') > -1; });
      for (var i = 0; i < paths.length; i++) {
        var blob = await gh(R + 'git/blobs', { content: uploads[paths[i]], encoding: 'base64' });
        files.push({ path: paths[i], mode: '100644', type: 'blob', sha: blob.sha });
      }
      var tree = await gh(R + 'git/trees', { base_tree: parent.tree.sha, tree: files });
      var commit = await gh(R + 'git/commits', { message: describe(saved, html), tree: tree.sha, parents: [head] });
      await gh(R + 'git/refs/heads/' + BRANCH, { sha: commit.sha }, 'PATCH');
      base = { commit: commit.sha, blob: page.sha, source: source };
      saved = html;
      paths.forEach(function (path) { delete uploads[path]; });
      cleanText = 'Uloženo, zveřejňuji web i PDF…';
      cleanTone = '';
      watch(commit.sha, source);
    } catch (err) {
      busy = false;
      if (err.status === 'conflict') {
        status(err.message, 'bad', [
          ['Přepsat mými změnami', function () { save(true); }],
          ['Načíst novou verzi', function () { reload(); }]
        ]);
      } else if (err.status === 401) {
        status(explain(err), 'bad');
        openLogin('Token už neplatí. Po přihlášení ulož znovu, rozpracované změny zůstanou.');
      } else {
        status('Neuloženo: ' + explain(err), 'bad', [['Zkusit znovu', function () { save(force); }]]);
      }
      update();
      return;
    }
    busy = false;
    refresh();
  }

  async function reload() {
    busy = true;
    update();
    try {
      base = await latest();
      hideTools();
      sheet().replaceWith(parse(sheetSource(base.source)));
      uploads = {};
      editing = false;
      startEditing();
    } catch (err) {
      status('Nepodařilo se načíst: ' + explain(err), 'bad');
    } finally {
      busy = false;
      update();
    }
  }

  // Commit message naming the parts of the CV that changed
  function describe(before, after) {
    var a = parse(before);
    var b = parse(after);
    var names = [];
    var head = function (page) { var h = page.querySelector('.header'); return h ? h.outerHTML : ''; };
    if (head(a) !== head(b)) names.push('header');
    var was = a.querySelectorAll('.section');
    b.querySelectorAll('.section').forEach(function (s, i) {
      var title = s.querySelector('.section-title');
      if (!was[i] || was[i].outerHTML !== s.outerHTML) names.push(title ? title.textContent.trim() : 'section');
    });
    if (was.length > b.querySelectorAll('.section').length) names.push('removed a section');
    return 'Web edit: ' + (names.filter(function (n, i) { return names.indexOf(n) === i; }).join(', ') || 'sheet');
  }

  // Wait until GitHub Pages serves the saved page (the PDF ships in the same deploy)
  async function watch(sha, source) {
    watching = sha;
    for (var i = 0; i < 45; i++) {
      await new Promise(function (resolve) { setTimeout(resolve, i ? 5000 : 20000); });
      if (watching !== sha) return;
      try {
        var res = await fetch(SITE + 'index.html?v=' + sha.slice(0, 7) + '-' + i, { cache: 'no-store' });
        if (res.ok && (await res.text()) === source) {
          if (watching !== sha) return;
          watching = null;
          cleanText = 'Uloženo a zveřejněno';
          cleanTone = 'good';
          toast('Zveřejněno: web i PDF jsou aktuální.');
          refresh();
          return;
        }
      } catch (e) { /* try again */ }
    }
    if (watching !== sha) return;
    watching = null;
    cleanText = 'Uloženo, ale web se zatím neaktualizoval – zkontroluj GitHub Actions';
    cleanTone = 'bad';
    refresh();
  }

  // Signed in but not editing: Pages may still serve the version before the last save (10 min cache)
  async function refreshShown() {
    try {
      base = await latest();
      if (!editing && show(sheetSource(base.source))) note('Zobrazena nejnovější verze, web se ještě aktualizuje.');
    } catch (e) { /* the served version stays */ }
  }

  /* ---------- UI ---------- */

  function button(cls, label, icon, act) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('data-act', act);
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[icon] + '</svg>';
    return b;
  }

  function status(text, tone, actions) {
    if (!ui.status) return;
    ui.status.replaceChildren(document.createTextNode(text || ''));
    ui.status.className = 'cv-status' + (tone ? ' cv-' + tone : '');
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cv-plain';
      b.textContent = a[0];
      b.addEventListener('click', a[1]);
      ui.status.append(' ', b);
    });
  }

  function note(text) {
    ui.note.textContent = text;
  }

  function toast(text, action, run) {
    clearTimeout(ui.toastTimer);
    ui.toast.replaceChildren(document.createTextNode(text));
    if (action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = action;
      b.addEventListener('click', function () { ui.toast.hidden = true; run(); });
      ui.toast.appendChild(b);
    }
    ui.toast.hidden = false;
    ui.toastTimer = setTimeout(function () { ui.toast.hidden = true; }, action ? 8000 : 5000);
  }

  function update(isDirty) {
    if (!ui.bar) return;
    if (isDirty === undefined) isDirty = dirty();
    ui.edit.hidden = !token || editing;
    ui.edit.disabled = busy;
    ui.bar.hidden = !editing;
    ui.save.disabled = busy || !isDirty;
    ui.save.textContent = busy ? 'Ukládám…' : 'Uložit';
    ui.close.disabled = busy;
    ui.signout.title = user ? 'Přihlášen jako ' + user : '';
  }

  function openLogin(message) {
    var form = ui.dialog.querySelector('form');
    form.reset();
    ui.error.textContent = message || '';
    if (!ui.dialog.open) ui.dialog.showModal();
    form.elements.token.focus();
  }

  async function onLogin(e) {
    e.preventDefault();
    var form = e.target;
    var value = form.elements.token.value.trim();
    var submit = form.querySelector('[type="submit"]');
    if (!value) return;
    ui.error.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Ověřuji…';
    var previous = token;
    token = value;
    try {
      // Only a 401 says the token is wrong; the user's name is just for the sign-out tooltip
      var me = await gh('user').catch(function (err) { if (err.status === 401) throw err; return null; });
      if (!editing) base = await latest();
      user = me ? me.login : '';
      remember(value, user, form.elements.remember.checked);
      ui.dialog.close();
      if (editing) {
        status('Přihlášeno, teď můžeš uložit.');
        update();
      } else {
        show(sheetSource(base.source));
        startEditing();
      }
    } catch (err) {
      token = previous;
      ui.error.textContent = err.status === 401 ? 'GitHub tenhle token nezná (překlep, vypršel nebo byl smazán).' : explain(err);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Přihlásit';
    }
  }

  function build() {
    var desk = document.querySelector('.desk');

    ui.edit = document.createElement('button');
    ui.edit.type = 'button';
    ui.edit.className = 'cv-secondary';
    ui.edit.textContent = 'Upravit';
    ui.edit.addEventListener('click', enter);
    ui.note = document.createElement('span');
    var exportBtn = document.getElementById('export-pdf');
    exportBtn.parentNode.insertBefore(ui.note, exportBtn);
    exportBtn.parentNode.insertBefore(ui.edit, exportBtn);

    ui.bar = document.createElement('div');
    ui.bar.className = 'cv-bar';
    ui.bar.hidden = true;
    ui.bar.setAttribute('role', 'region');
    ui.bar.setAttribute('aria-label', 'Úpravy životopisu');
    ui.bar.innerHTML = '<div class="cv-bar-in">'
      + '<div class="cv-state"><strong>Úpravy</strong><span class="cv-status" role="status"></span><span class="cv-fit"></span></div>'
      + '<div class="cv-buttons">'
      + '<button type="button" class="cv-plain" data-act="tips" aria-expanded="false">Nápověda</button>'
      + '<button type="button" class="cv-plain" data-act="signout">Odhlásit</button>'
      + '<button type="button" class="cv-secondary" data-act="close">Zavřít</button>'
      + '<button type="button" class="cv-primary" data-act="save">Uložit</button>'
      + '</div>'
      + '<div class="cv-tips" hidden>Klikni do textu a piš. V odrážkách Enter přidá další odrážku, v odstavci nový řádek, '
      + '<kbd>Ctrl</kbd>+<kbd>B</kbd> píše tučně. Nad položkou, kontaktem nebo nadpisem sekce pod myší je panel: posunout, '
      + 'zduplikovat, smazat, u práce i logo. Fotku nebo logo vyměníš kliknutím (nebo přetažením souboru). '
      + 'Kontaktu se odkaz nastaví podle textu. <kbd>Ctrl</kbd>+<kbd>S</kbd> uloží, každé uložení je commit '
      + '(<a href="https://github.com/' + REPO + '/commits/' + BRANCH + '" target="_blank" rel="noopener">historie</a>).</div>'
      + '</div>';
    desk.insertBefore(ui.bar, desk.firstChild);
    ui.status = ui.bar.querySelector('.cv-status');
    ui.fit = ui.bar.querySelector('.cv-fit');
    ui.save = ui.bar.querySelector('[data-act="save"]');
    ui.close = ui.bar.querySelector('[data-act="close"]');
    ui.signout = ui.bar.querySelector('[data-act="signout"]');
    var tips = ui.bar.querySelector('.cv-tips');
    var tipsBtn = ui.bar.querySelector('[data-act="tips"]');
    tipsBtn.addEventListener('click', function () {
      tips.hidden = !tips.hidden;
      tipsBtn.setAttribute('aria-expanded', String(!tips.hidden));
    });
    ui.save.addEventListener('click', function () { save(false); });
    ui.close.addEventListener('click', close);
    ui.signout.addEventListener('click', signOut);

    ui.tools = document.createElement('div');
    ui.tools.className = 'cv-ui cv-tools';
    ui.tools.setAttribute('role', 'toolbar');
    ui.tools.append(
      button('', 'Posunout nahoru', 'up', 'up'),
      button('', 'Posunout dolů', 'down', 'down'),
      button('', 'Duplikovat', 'copy', 'copy'),
      button('', 'Smazat', 'remove', 'remove'),
      document.createElement('hr'),
      button('', 'Nahrát logo', 'logo', 'logo'),
      button('', 'Odebrat logo', 'unlogo', 'unlogo')
    );

    ui.file = document.createElement('input');
    ui.file.type = 'file';
    ui.file.accept = 'image/*';
    ui.file.hidden = true;
    ui.file.addEventListener('change', function () {
      var target = picking;
      picking = null;
      useFile(ui.file.files[0], target);
    });

    ui.toast = document.createElement('div');
    ui.toast.className = 'cv-toast';
    ui.toast.setAttribute('role', 'status');
    ui.toast.hidden = true;

    ui.dialog = document.createElement('dialog');
    ui.dialog.className = 'cv-dialog';
    ui.dialog.setAttribute('aria-labelledby', 'cv-login-title');
    ui.dialog.innerHTML = '<form>'
      + '<h2 id="cv-login-title">Úpravy životopisu</h2>'
      + '<p>Přihlas se GitHub tokenem, který smí zapisovat do repozitáře <b>' + REPO + '</b>. Token zůstane jen v tomhle prohlížeči.</p>'
      + '<input type="text" name="username" autocomplete="username" value="Jaffator" hidden>'
      + '<label class="cv-field">GitHub token<input type="password" name="token" autocomplete="current-password" spellcheck="false" placeholder="github_pat_…" required></label>'
      + '<label class="cv-check"><input type="checkbox" name="remember" checked>Zapamatovat na tomto zařízení</label>'
      + '<p class="cv-hint">Nemáš token? <a target="_blank" rel="noopener">Vytvoř ho na GitHubu</a>: u <b>Repository access</b> zvol '
      + '<b>Only select repositories</b> a repozitář <b>cv</b>, oprávnění <b>Contents: Read and write</b> už je předvyplněné.</p>'
      + '<p class="cv-error" role="alert"></p>'
      + '<div class="cv-actions"><button type="button" class="cv-secondary" data-act="cancel">Zrušit</button>'
      + '<button type="submit" class="cv-primary">Přihlásit</button></div>'
      + '</form>';
    ui.dialog.querySelector('.cv-hint a').href = NEW_TOKEN;
    ui.error = ui.dialog.querySelector('.cv-error');
    ui.dialog.querySelector('form').addEventListener('submit', onLogin);
    ui.dialog.querySelector('[data-act="cancel"]').addEventListener('click', function () { ui.dialog.close(); });
    ui.dialog.addEventListener('close', function () {
      if (!editing && location.hash === '#edit') history.replaceState(null, '', location.pathname + location.search);
    });

    document.body.append(ui.file, ui.toast, ui.dialog);
  }

  function listen() {
    document.addEventListener('beforeinput', onBeforeInput);
    document.addEventListener('paste', onPaste);
    document.addEventListener('input', onInput);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('focusin', function (e) {
      var block = editing && blockAt(e.target);
      if (block) activate(block);
    });
    // Hover switches blocks after a short pause, so the pointer can travel to the toolbar across a neighbour
    var hover = 0;
    document.addEventListener('pointerover', function (e) {
      if (!editing) return;
      clearTimeout(hover);
      var block = blockAt(e.target);
      if (block && block !== ui.block) hover = setTimeout(function () { activate(block); }, 150);
    });
    // In the sheet a click edits: links do not open, pictures get replaced, toolbar buttons act
    document.addEventListener('click', function (e) {
      if (!editing || !e.target.closest || !e.target.closest('.page')) return;
      var tool = e.target.closest('.cv-tools button, .cv-logo-slot');
      if (tool) {
        e.preventDefault();
        e.stopPropagation();
        act(tool.getAttribute('data-act'), tool);
        return;
      }
      if (e.target.closest('a')) e.preventDefault();
      var img = e.target.closest('img.photo, img.logo');
      if (img) pick(targetOf(img));
    }, true);
    // A dropped file would make the browser leave the page; on a picture it replaces the picture
    document.addEventListener('dragover', function (e) {
      if (editing && e.dataTransfer && Array.from(e.dataTransfer.types).indexOf('Files') > -1) e.preventDefault();
    });
    document.addEventListener('drop', function (e) {
      if (!editing || !e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      var spot = e.target.closest && e.target.closest('.page img.photo, .page img.logo, .page .cv-logo-slot');
      if (spot) useFile(e.dataTransfer.files[0], targetOf(spot));
    });
    document.addEventListener('keydown', function (e) {
      if (!editing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save(false);
      } else if (e.key === 'Escape' && fieldOf(document.activeElement)) {
        document.activeElement.blur();
      }
    });
    window.addEventListener('beforeunload', function (e) {
      if (!dirty()) return;
      e.preventDefault();
      e.returnValue = '';
    });
    window.addEventListener('hashchange', function () {
      if (location.hash === '#edit') enter();
    });
  }

  function init() {
    build();
    listen();
    update();
    if (location.hash === '#edit') enter();
    else if (token) refreshShown();
  }

  var css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'editor.css';
  css.onload = css.onerror = init;
  document.head.appendChild(css);
})();
