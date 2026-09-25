/* Daybook: a private, offline journal. All data lives in this device's IndexedDB. */
'use strict';

const APP_VERSION = '1.0.0';

/* ---------- small utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, cls = '') => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
const uuid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
const MOOD_NAMES = ['Awful', 'Bad', 'Okay', 'Good', 'Great'];
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const fmtLong = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const isoZ = (x) => new Date(x).toISOString().replace(/\.\d{3}Z$/, 'Z');
const wordCount = (t) => (String(t).match(/\S+/g) || []).length;
const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); return fn(...a); }; f.cancel = () => clearTimeout(t); return f; };
const fmtBytes = (n) => n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';

function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- MD5 (for Day One-compatible photo filenames) ---------- */
const MD5_K = (() => { const k = new Uint32Array(64); for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296); return k; })();
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
function md5(bytes) {
  const len = bytes.length, total = (((len + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(total); buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (len * 8) >>> 0, true); dv.setUint32(total - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      const s = MD5_S[(i >> 4) * 4 + (i % 4)];
      A = D; D = C; C = B; B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('daybook', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('entries', { keyPath: 'id' });
        d.createObjectStore('photos', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  store(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  all(s) { return this.req(this.store(s).getAll()); },
  get(s, k) { return this.req(this.store(s).get(k)); },
  put(s, v) { return this.req(this.store(s, 'readwrite').put(v)); },
  del(s, k) { return this.req(this.store(s, 'readwrite').delete(k)); },
  keys(s) { return this.req(this.store(s).getAllKeys()); },
  async meta(k, def) { const r = await this.get('meta', k); return r ? r.value : def; },
  setMeta(k, v) { return this.put('meta', { key: k, value: v }); },
};

/* ---------- state ---------- */
const S = {
  entries: [], journals: [], view: 'timeline', filter: 'all', limit: 120,
  calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel: dayKey(new Date()),
  search: { q: '', tags: new Set(), starred: false },
  lock: null, lockAfter: 1, lastBackup: null, hiddenAt: 0, locked: false, updateReady: null,
};
const jname = (id) => (S.journals.find((j) => j.id === id) || { name: 'Journal' }).name;
const live = () => S.entries.filter((e) => !e.deleted && (S.filter === 'all' || e.journal === S.filter))
  .sort((a, b) => new Date(b.created) - new Date(a.created));

async function loadAll() {
  S.entries = await DB.all('entries');
  S.journals = await DB.meta('journals', null);
  if (!S.journals || !S.journals.length) { S.journals = [{ id: 'default', name: 'Journal' }]; await DB.setMeta('journals', S.journals); }
  S.lock = await DB.meta('lock', null);
  S.lockAfter = await DB.meta('lockAfter', 1);
  S.lastBackup = await DB.meta('lastBackup', null);
  if (S.filter !== 'all' && !S.journals.some((j) => j.id === S.filter)) S.filter = 'all';
}

/* ---------- photos ---------- */
const urlCache = new Map();
async function photoURL(id, thumb) {
  const key = id + (thumb ? ':t' : '');
  if (urlCache.has(key)) return urlCache.get(key);
  const rec = await DB.get('photos', id);
  if (!rec) return '';
  const data = thumb && rec.thumb ? rec.thumb : rec.data;
  const u = URL.createObjectURL(new Blob([data], { type: thumb && rec.thumb ? 'image/jpeg' : rec.type }));
  urlCache.set(key, u); return u;
}
function hydrate(root) {
  $$('img[data-photo]', root).forEach(async (img) => {
    if (img.getAttribute('src')) return;
    img.src = await photoURL(img.dataset.photo, img.hasAttribute('data-thumb'));
  });
}
function loadImg(blob) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob); const im = new Image();
    im.onload = () => res({ im, u });
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not read that image')); };
    im.src = u;
  });
}
async function scaleTo(im, max, q) {
  let w = im.naturalWidth, h = im.naturalHeight; const s = Math.min(1, max / Math.max(w, h));
  w = Math.round(w * s); h = Math.round(h * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(im, 0, 0, w, h);
  const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
  return { buf: await b.arrayBuffer(), w, h };
}
async function makePhoto(blob) {
  const { im, u } = await loadImg(blob);
  try {
    const full = await scaleTo(im, 2048, 0.85), th = await scaleTo(im, 360, 0.72);
    return { id: uuid(), type: 'image/jpeg', data: full.buf, thumb: th.buf, w: full.w, h: full.h,
      md5: md5(new Uint8Array(full.buf)), created: new Date().toISOString() };
  } finally { URL.revokeObjectURL(u); }
}
async function deletePhotos(ids) {
  for (const id of ids || []) {
    await DB.del('photos', id);
    for (const k of [id, id + ':t']) if (urlCache.has(k)) { URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); }
  }
}

/* ---------- entry persistence ---------- */
async function saveEntry(e) {
  e.modified = new Date().toISOString();
  await DB.put('entries', e);
  const i = S.entries.findIndex((x) => x.id === e.id);
  if (i >= 0) S.entries[i] = e; else S.entries.push(e);
  if (navigator.storage && navigator.storage.persist && !saveEntry._asked) { saveEntry._asked = true; navigator.storage.persist().catch(() => {}); }
}
async function hardDelete(e) {
  await deletePhotos(e.photos); await DB.del('entries', e.id);
  S.entries = S.entries.filter((x) => x.id !== e.id);
}
async function purgeTrash() {
  const cutoff = Date.now() - 30 * 864e5;
  for (const e of S.entries.filter((x) => x.deleted && new Date(x.deleted).getTime() < cutoff)) await hardDelete(e);
}

/* ---------- text helpers ---------- */
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])[*_]([^*_\s][^*_]*?)[*_](?![*\w])/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
function md(src) {
  const out = []; let para = [], list = null;
  const flushP = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>` + list.items.map((i) => '<li>' + inline(i) + '</li>').join('') + `</${list.t}>`); list = null; } };
  for (const ln of esc(src).split('\n')) {
    let m;
    if (!ln.trim()) { flushP(); flushL(); continue; }
    if ((m = ln.match(/^(#{1,3})\s+(.*)/))) { flushP(); flushL(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = ln.match(/^&gt;\s?(.*)/))) { flushP(); flushL(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushL(); para.push(ln);
  }
  flushP(); flushL(); return out.join('');
}
const plain = (s) => s.replace(/^#{1,3}\s+/gm, '').replace(/[*_`>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
function titleSnip(text) {
  const lines = plain(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return { title: lines[0] || '', snip: lines.slice(1).join(' ') };
}
function hl(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const re = new RegExp('(' + esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}
function around(text, q, n = 70) {
  const t = plain(text).replace(/\s+/g, ' ');
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return t.slice(0, n * 2);
  const a = Math.max(0, i - n); return (a ? '…' : '') + t.slice(a, i + q.length + n) + (i + q.length + n < t.length ? '…' : '');
}

/* ---------- common fragments ---------- */
function entryCard(e, q) {
  const d = new Date(e.created); const { title, snip } = titleSnip(e.text);
  const meta = [];
  if (e.starred) meta.push(ic('star', 'star'));
  if (e.mood) meta.push(MOODS[e.mood - 1]);
  meta.push(esc(fmtTime(d)));
  if (e.location) meta.push(ic('pin') + esc(e.location.name || 'Location'));
  if (e.tags && e.tags.length) meta.push(ic('tag') + esc(e.tags.join(', ')));
  if (S.filter === 'all' && S.journals.length > 1) meta.push(ic('book') + esc(jname(e.journal)));
  const snipText = q ? around(e.text, q) : snip;
  return `<button class="card entry" data-open="${e.id}">
    <div class="d"><b>${d.getDate()}</b><small>${DOW[d.getDay()]}</small></div>
    <div class="body"><div class="title">${hl(title || (e.photos && e.photos.length ? 'Photo' : 'Untitled'), q)}</div>
      ${snipText ? `<div class="snip">${hl(snipText, q)}</div>` : ''}
      <div class="meta">${meta.map((x) => `<span class="row" style="gap:3px">${x}</span>`).join('')}</div></div>
    ${e.photos && e.photos.length ? `<img class="th" data-photo="${e.photos[0]}" data-thumb alt="">` : ''}
  </button>`;
}
function computeStats(list) {
  const days = new Set(list.map((e) => dayKey(new Date(e.created))));
  let streak = 0; const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  return { entries: list.length, days: days.size, streak, words: list.reduce((n, e) => n + wordCount(e.text), 0),
    photos: list.reduce((n, e) => n + (e.photos ? e.photos.length : 0), 0) };
}
function backupBanner() {
  const n = S.entries.filter((e) => !e.deleted).length;
  if (S.updateReady) return `<div class="banner">${ic('in')}<span>A new version of Daybook is ready.</span><button data-act="update">Reload</button></div>`;
  if (!n) return '';
  const age = S.lastBackup ? (Date.now() - new Date(S.lastBackup)) / 864e5 : Infinity;
  if (age < 14) return '';
  const when = S.lastBackup ? `Last backup ${Math.floor(age)} days ago.` : 'Not backed up yet.';
  return `<div class="banner">${ic('db')}<span>${when} Your journal lives only on this phone.</span><button data-act="backup">Back up</button></div>`;
}

/* ---------- main views ---------- */
const main = () => $('#main');
function render() {
  const titles = { timeline: 'Journal', calendar: 'Calendar', media: 'Photos', search: 'Search' };
  $('#view-title').textContent = S.filter !== 'all' && S.view === 'timeline' ? jname(S.filter) : titles[S.view];
  $$('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  const sel = $('#journal-filter');
  sel.innerHTML = `<option value="all">All journals</option>` + S.journals.map((j) => `<option value="${j.id}">${esc(j.name)}</option>`).join('');
  sel.value = S.filter; sel.parentElement.classList.toggle('hidden', S.journals.length < 2);
  ({ timeline: renderTimeline, calendar: renderCalendar, media: renderMedia, search: renderSearch })[S.view]();
}

function renderTimeline() {
  const list = live(); let h = backupBanner();
  if (!list.length) {
    h += `<div class="empty"><h2>Nothing written yet</h2><p>Tap + to start. Entries, photos and everything else stay on this phone and work with no signal.</p></div>`;
  } else {
    const st = computeStats(list);
    h += `<div class="stats"><div class="card"><b>${st.entries}</b><small>entries</small></div><div class="card"><b>${st.streak}</b><small>day streak</small></div><div class="card"><b>${st.words.toLocaleString()}</b><small>words</small></div></div>`;
    const now = new Date();
    const otd = list.filter((e) => { const d = new Date(e.created); return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear(); });
    if (otd.length) {
      h += `<div class="card otd"><h3>On this day</h3>${otd.map((e) => { const d = new Date(e.created); const y = now.getFullYear() - d.getFullYear();
        return `<button data-open="${e.id}"><b>${y} year${y > 1 ? 's' : ''} ago</b> · ${esc(titleSnip(e.text).title || 'Untitled')}</button>`; }).join('')}</div>`;
    }
    let cur = '';
    for (const e of list.slice(0, S.limit)) {
      const m = new Date(e.created).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (m !== cur) { h += `<div class="month">${m}</div>`; cur = m; }
      h += entryCard(e);
    }
    if (list.length > S.limit) h += `<button class="btn ghost" style="width:100%;margin-top:6px" data-act="more">Show older entries (${list.length - S.limit} more)</button>`;
  }
  main().innerHTML = h; hydrate(main());
}

function renderCalendar() {
  const list = live(); const byDay = new Map();
  for (const e of list) { const k = dayKey(new Date(e.created)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
  const m = S.calMonth, first = new Date(m.getFullYear(), m.getMonth(), 1), days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const today = dayKey(new Date());
  let cells = DOW.map((d) => `<div class="dow">${d[0]}</div>`).join('') + '<div></div>'.repeat(first.getDay());
  for (let i = 1; i <= days; i++) {
    const k = dayKey(new Date(m.getFullYear(), m.getMonth(), i));
    cells += `<button data-day="${k}" class="${byDay.has(k) ? 'has' : ''} ${k === today ? 'today' : ''} ${k === S.calSel ? 'sel' : ''}">${i}</button>`;
  }
  const sel = byDay.get(S.calSel) || [];
  const [y, mo, d] = S.calSel.split('-').map(Number); const selDate = new Date(y, mo - 1, d);
  const monthCount = list.filter((e) => { const x = new Date(e.created); return x.getFullYear() === m.getFullYear() && x.getMonth() === m.getMonth(); }).length;
  main().innerHTML = `
    <div class="cal-head"><button class="iconbtn" data-act="prev" aria-label="Previous month">${ic('back')}</button>
      <h2>${m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
      <button class="iconbtn" data-act="next" aria-label="Next month">${ic('fwd')}</button></div>
    <div class="card cal">${cells}</div>
    <p class="note">${monthCount} entr${monthCount === 1 ? 'y' : 'ies'} this month</p>
    <div class="month">${esc(fmtLong(selDate))}</div>
    ${sel.map((e) => entryCard(e)).join('') || `<button class="btn ghost" style="width:100%" data-act="write-day">Write an entry for this day</button>`}`;
  hydrate(main());
}

function renderMedia() {
  const items = [];
  for (const e of live()) for (const p of e.photos || []) items.push({ p, e: e.id });
  main().innerHTML = items.length
    ? `<div class="grid">${items.map((x) => `<button data-open="${x.e}"><img data-photo="${x.p}" data-thumb alt="" loading="lazy"></button>`).join('')}</div>`
    : `<div class="empty"><h2>No photos yet</h2><p>Add photos to an entry with the camera button in the editor.</p></div>`;
  hydrate(main());
}

function renderSearch() {
  if (!$('#search-q', main())) {
    main().innerHTML = `<div class="searchbox">${ic('search')}<input id="search-q" type="search" placeholder="Search entries" autocomplete="off"></div>
      <div class="chips" id="search-chips"></div><div id="search-res"></div>`;
    $('#search-q').value = S.search.q;
    $('#search-q').addEventListener('input', (ev) => { S.search.q = ev.target.value; renderSearchResults(); });
  }
  renderSearchResults();
}
function renderSearchResults() {
  const all = live(); const counts = new Map();
  for (const e of all) for (const t of e.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  $('#search-chips').innerHTML = `<button class="chip ${S.search.starred ? 'on' : ''}" data-act="f-star">${ic('star')} Starred</button>` +
    tags.map(([t, n]) => `<button class="chip ${S.search.tags.has(t) ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)} <small>${n}</small></button>`).join('');
  const q = S.search.q.trim(); const ql = q.toLowerCase();
  const res = all.filter((e) => (!S.search.starred || e.starred)
    && [...S.search.tags].every((t) => (e.tags || []).includes(t))
    && (!ql || e.text.toLowerCase().includes(ql) || (e.tags || []).some((t) => t.toLowerCase().includes(ql)) || (e.location && (e.location.name || '').toLowerCase().includes(ql))));
  const active = q || S.search.starred || S.search.tags.size;
  $('#search-res').innerHTML = !active ? `<p class="note">Search words, tags and places. Tap a tag to filter.</p>`
    : `<p class="note">${res.length} result${res.length === 1 ? '' : 's'}</p>` + res.slice(0, 200).map((e) => entryCard(e, q)).join('');
  hydrate($('#search-res'));
}

/* ---------- sheets & dialogs ---------- */
function sheet(html) { const el = document.createElement('div'); el.className = 'sheet'; el.innerHTML = html; document.body.appendChild(el); return el; }
function viewPhoto(id) {
  const v = document.createElement('div'); v.id = 'viewer'; v.innerHTML = `<img alt="">`;
  photoURL(id).then((u) => { $('img', v).src = u; });
  v.onclick = () => v.remove(); document.body.appendChild(v);
}

/* ---------- reader ---------- */
function openReader(id) {
  const el = sheet(''); el.dataset.reader = id; renderReader(el);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); const ph = ev.target.closest('img[data-photo]');
    const e = S.entries.find((x) => x.id === el.dataset.reader);
    if (ph) return viewPhoto(ph.dataset.photo);
    if (!a || !e) return;
    const act = a.dataset.a;
    if (act === 'back') el.remove();
    if (act === 'edit') openEditor(e);
    if (act === 'star') { e.starred = !e.starred; await saveEntry(e); renderReader(el); render(); }
    if (act === 'del') {
      if (!confirm('Move this entry to Recently Deleted? You can restore it for 30 days from Settings.')) return;
      e.deleted = new Date().toISOString(); await saveEntry(e); el.remove(); render(); toast('Moved to Recently Deleted');
    }
  });
}
function renderReader(el) {
  const e = S.entries.find((x) => x.id === el.dataset.reader); if (!e) { el.remove(); return; }
  const d = new Date(e.created);
  const facts = [
    `<div>${ic('clock')}${esc(fmtLong(d))}, ${esc(fmtTime(d))}${e.tz && e.tz !== TZ ? ` (${esc(e.tz)})` : ''}</div>`,
    S.journals.length > 1 ? `<div>${ic('book')}${esc(jname(e.journal))}</div>` : '',
    e.mood ? `<div><span style="font-size:18px">${MOODS[e.mood - 1]}</span>${MOOD_NAMES[e.mood - 1]}</div>` : '',
    e.location ? `<div>${ic('pin')}<a style="color:var(--accent)" href="https://maps.apple.com/?ll=${e.location.lat},${e.location.lon}&q=${encodeURIComponent(e.location.name || 'Entry location')}" target="_blank" rel="noopener">${esc(e.location.name || `${e.location.lat.toFixed(4)}, ${e.location.lon.toFixed(4)}`)}</a></div>` : '',
    e.weather ? `<div>${ic('bulb')}${esc([e.weather.desc, e.weather.tempC != null ? Math.round(e.weather.tempC * 9 / 5 + 32) + '°F' : ''].filter(Boolean).join(', '))}</div>` : '',
    e.tags && e.tags.length ? `<div>${ic('tag')}${e.tags.map((t) => '#' + esc(t)).join(' ')}</div>` : '',
    `<div>${ic('doc')}${wordCount(e.text)} words${e.modified ? ` · edited ${esc(fmtShort(new Date(e.modified)))}` : ''}</div>`,
  ].join('');
  el.innerHTML = `<header><button class="txtbtn l" data-a="back">‹ Back</button>
      <div class="ttl">${esc(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}<small>${esc(fmtTime(d))}</small></div>
      <button class="txtbtn r" data-a="edit">Edit</button></header>
    <div class="scroll reader">
      <div class="md">${md(e.text) || '<p style="color:var(--muted)">No text.</p>'}</div>
      ${e.photos && e.photos.length ? `<div class="pics">${e.photos.map((p) => `<img data-photo="${p}" alt="">`).join('')}</div>` : ''}
      <div class="card facts">${facts}</div>
      <div class="row" style="justify-content:space-between;margin-top:14px">
        <button class="btn ghost" data-a="star">${e.starred ? 'Unstar' : 'Star'}</button>
        <button class="btn danger" data-a="del">Delete</button></div>
    </div>`;
  hydrate(el);
}

/* ---------- editor ---------- */
const PROMPTS = [
  'What made today different from yesterday?', 'What are three things you are grateful for right now?',
  'Who did you talk to today, and what stuck with you?', 'What is taking up the most room in your head this week?',
  'Describe where you are right now using all five senses.', 'What did you learn today?',
  'What would make tomorrow a good day?', 'What is something you finished recently that you are proud of?',
  'What is a decision you are weighing? Write out both sides.', 'What surprised you this week?',
  'Write about a person who shaped how you work.', 'What does a perfect ordinary day look like for you?',
  'What is one thing you want to remember about this season of life?', 'What did you put off today, and why?',
  'Describe a meal worth remembering.', 'What is something you changed your mind about?',
  'Where did you spend your energy today? Where did it come back?', 'What conversation do you need to have?',
  'What is a small win from today?', 'Write a note to yourself one year from now.',
  'What made you laugh recently?', 'What are you looking forward to this month?',
  'What would you tell someone starting the job you have now?', 'Describe a place you want to go back to.',
  'What did the weather feel like today, and how did it set the tone?', 'What is one habit you want to keep and one you want to drop?',
];
const TEMPLATES = [
  { name: 'Daily review', text: '# Daily review\n\n**Highlights**\n- \n\n**What went well**\n- \n\n**What I would change**\n- \n\n**Tomorrow**\n- ' },
  { name: 'Gratitude', text: '# Grateful for\n\n1. \n2. \n3. \n\n**Why the first one mattered:** ' },
  { name: 'Trip day', text: '# Day on the road\n\n**Where:** \n**Who:** \n\n**What we did**\n\n**Best moment**\n\n**Food worth remembering**\n' },
  { name: 'Meeting notes', text: '# Meeting: \n\n**Who:** \n\n**Decisions**\n- \n\n**Follow-ups**\n- ' },
];
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function openEditor(existing, onDate) {
  const isNew = !existing;
  const start = onDate ? (() => { const n = new Date(); const [y, m, d] = onDate.split('-').map(Number); return new Date(y, m - 1, d, n.getHours(), n.getMinutes()); })() : new Date();
  const e = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uuid(), journal: S.filter !== 'all' ? S.filter : S.journals[0].id, created: start.toISOString(), modified: null,
    tz: TZ, text: '', tags: [], mood: null, starred: false, location: null, photos: [], deleted: null,
  };
  let persisted = !isNew, dirty = false;
  const hasContent = () => e.text.trim() || e.photos.length;
  const persist = async () => { if (!dirty || (!persisted && !hasContent())) return; dirty = false; await saveEntry(e); persisted = true; };
  const autosave = debounce(persist, 500);
  const changed = () => { dirty = true; autosave(); };

  const el = sheet(`<header>
      <button class="txtbtn l" data-a="discard">${isNew ? 'Discard' : ''}</button>
      <div class="ttl" style="position:relative"><span id="ed-when"></span><small>Tap to change date</small>
        <input type="datetime-local" id="ed-date" style="position:absolute;inset:0;opacity:0;width:100%" aria-label="Entry date"></div>
      <button class="txtbtn r" data-a="done">Done</button></header>
    <div class="scroll"><div class="ed-meta" id="ed-meta"></div><div class="photos" id="ed-photos"></div>
      <textarea id="ed-text" placeholder="What's on your mind?"></textarea></div>
    <div id="ed-pop"></div>
    <div class="toolbar">
      <label aria-label="Add photos">${ic('camera')}<input type="file" accept="image/*" multiple hidden id="ed-file"></label>
      <button data-a="tags" aria-label="Tags">${ic('tag')}</button>
      <button data-a="mood" aria-label="Mood">${ic('smile')}</button>
      <button data-a="loc" aria-label="Location">${ic('pin')}</button>
      <button data-a="star" aria-label="Star">${ic('star')}</button>
      <button data-a="prompt" aria-label="Prompts and templates">${ic('bulb')}</button>
    </div>`);
  const ta = $('#ed-text', el), pop = $('#ed-pop', el);
  ta.value = e.text;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, window.innerHeight * 0.45) + 'px'; };
  ta.addEventListener('input', () => { e.text = ta.value; grow(); changed(); });

  const paintWhen = () => { const d = new Date(e.created); $('#ed-when', el).textContent = `${fmtShort(d)}, ${fmtTime(d)}`; $('#ed-date', el).value = toLocalInput(d); };
  $('#ed-date', el).addEventListener('change', (ev) => { if (!ev.target.value) return; e.created = new Date(ev.target.value).toISOString(); paintWhen(); changed(); });

  const paintMeta = () => {
    const chips = [];
    if (S.journals.length > 1) chips.push(`<label class="chip">${ic('book')}<select data-journal style="border:0;background:transparent;font-size:13px">${S.journals.map((j) => `<option value="${j.id}" ${j.id === e.journal ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}</select></label>`);
    if (e.starred) chips.push(`<span class="chip">${ic('star', 'star')} Starred</span>`);
    if (e.mood) chips.push(`<button class="chip" data-a="mood">${MOODS[e.mood - 1]} ${MOOD_NAMES[e.mood - 1]}</button>`);
    if (e.location) chips.push(`<button class="chip" data-a="loc">${ic('pin')} ${esc(e.location.name || 'Location saved')}</button>`);
    for (const t of e.tags) chips.push(`<button class="chip" data-a="tags">#${esc(t)}</button>`);
    $('#ed-meta', el).innerHTML = chips.join('');
    const sj = $('[data-journal]', el); if (sj) sj.onchange = () => { e.journal = sj.value; changed(); };
    $('[data-a=star]', el).classList.toggle('on', e.starred);
  };
  const paintPhotos = () => {
    $('#ed-photos', el).innerHTML = e.photos.map((p) => `<div class="ph"><img data-photo="${p}" data-thumb alt=""><button class="x" data-rm="${p}" aria-label="Remove photo">×</button></div>`).join('');
    hydrate($('#ed-photos', el));
  };
  paintWhen(); paintMeta(); paintPhotos(); requestAnimationFrame(grow);
  if (isNew) setTimeout(() => ta.focus(), 250);

  $('#ed-file', el).addEventListener('change', async (ev) => {
    const files = [...ev.target.files]; ev.target.value = '';
    if (!files.length) return;
    toast(`Adding ${files.length} photo${files.length > 1 ? 's' : ''}…`);
    for (const f of files) {
      try { const p = await makePhoto(f); await DB.put('photos', p); e.photos.push(p.id); dirty = true; }
      catch (err) { toast(err.message); }
    }
    paintPhotos(); await persist();
  });

  const showPop = (html) => { pop.innerHTML = html ? `<div class="pop">${html}</div>` : ''; };
  const tagPop = () => {
    const all = [...new Set(S.entries.flatMap((x) => x.tags || []))].filter((t) => !e.tags.includes(t)).sort();
    showPop(`<h4>Tags</h4><div class="chips">${e.tags.map((t) => `<button class="chip on" data-untag="${esc(t)}">#${esc(t)} ×</button>`).join('')}</div>
      <div class="row"><input type="text" id="tag-in" placeholder="Add a tag" autocapitalize="none"><button class="btn" data-a="tag-add">Add</button></div>
      ${all.length ? `<div class="chips" style="margin-top:8px">${all.slice(0, 30).map((t) => `<button class="chip" data-addtag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}`);
    const inp = $('#tag-in', el);
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addTag(inp.value); } });
  };
  const addTag = (raw) => {
    const t = raw.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
    if (t && !e.tags.includes(t)) { e.tags.push(t); paintMeta(); changed(); }
    tagPop();
  };
  const locPop = () => {
    if (!e.location) { showPop(''); return; }
    showPop(`<h4>Location</h4><div class="row"><input type="text" id="loc-name" placeholder="Name this place (e.g. Home)" value="${esc(e.location.name || '')}"><button class="btn" data-a="loc-ok">Save</button></div>
      <p class="note" style="margin:8px 0 0">${e.location.lat.toFixed(5)}, ${e.location.lon.toFixed(5)} · Place names you type are reused automatically next time you're nearby.</p>
      <button class="btn danger" data-a="loc-rm" style="margin-top:4px;padding-left:0">Remove location</button>`);
  };
  const nearestName = (lat, lon) => {
    let best = null, bd = 250; // meters
    for (const x of S.entries) {
      if (!x.location || !x.location.name) continue;
      const dy = (x.location.lat - lat) * 111320, dx = (x.location.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180);
      const dist = Math.hypot(dx, dy); if (dist < bd) { bd = dist; best = x.location.name; }
    }
    return best;
  };

  el.addEventListener('click', async (ev) => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) {
      if (!confirm('Remove this photo from the entry?')) return;
      e.photos = e.photos.filter((p) => p !== rm.dataset.rm); await deletePhotos([rm.dataset.rm]); paintPhotos(); dirty = true; await persist(); return;
    }
    const ph = ev.target.closest('img[data-photo]'); if (ph) return viewPhoto(ph.dataset.photo);
    const ut = ev.target.closest('[data-untag]'); if (ut) { e.tags = e.tags.filter((t) => t !== ut.dataset.untag); paintMeta(); changed(); tagPop(); return; }
    const at = ev.target.closest('[data-addtag]'); if (at) { addTag(at.dataset.addtag); return; }
    const mo = ev.target.closest('[data-mood]'); if (mo) { const v = +mo.dataset.mood; e.mood = e.mood === v ? null : v; paintMeta(); changed(); showPop(''); return; }
    const pr = ev.target.closest('[data-prompt]'); if (pr) { insertText(pr.dataset.prompt + '\n\n'); showPop(''); return; }
    const tp = ev.target.closest('[data-tpl]'); if (tp) { insertText(TEMPLATES[+tp.dataset.tpl].text); showPop(''); return; }
    const a = ev.target.closest('[data-a]'); if (!a) return;
    switch (a.dataset.a) {
      case 'done':
        await autosave.flush();
        if (persisted && !hasContent()) {
          if (isNew) await hardDelete(e);
          else { e.deleted = new Date().toISOString(); await saveEntry(e); const r0 = $('.sheet[data-reader]'); if (r0) r0.remove(); toast('Empty entry moved to Recently Deleted'); }
        }
        el.remove(); render(); const rd = $('.sheet[data-reader]'); if (rd) renderReader(rd);
        break;
      case 'discard':
        if (hasContent() && !confirm('Discard this entry?')) return;
        autosave.cancel(); dirty = false; await deletePhotos(e.photos);
        if (persisted) await hardDelete(e);
        el.remove(); render(); break;
      case 'star': e.starred = !e.starred; paintMeta(); changed(); break;
      case 'mood':
        if (pop.dataset.open === 'mood') { pop.dataset.open = ''; showPop(''); break; }
        pop.dataset.open = 'mood';
        showPop(`<h4>How are you feeling?</h4><div class="moods">${MOODS.map((m, i) => `<button data-mood="${i + 1}" class="${e.mood === i + 1 ? 'on' : ''}" aria-label="${MOOD_NAMES[i]}">${m}</button>`).join('')}</div>`);
        break;
      case 'tags':
        if (pop.dataset.open === 'tags') { pop.dataset.open = ''; showPop(''); break; }
        pop.dataset.open = 'tags'; tagPop(); break;
      case 'tag-add': addTag($('#tag-in', el).value); break;
      case 'loc':
        if (e.location) { pop.dataset.open = 'loc'; locPop(); break; }
        if (!navigator.geolocation) { toast('Location is not available on this device'); break; }
        toast('Finding your location…', 8000);
        navigator.geolocation.getCurrentPosition((pos) => {
          const { latitude: lat, longitude: lon } = pos.coords;
          e.location = { lat, lon, name: nearestName(lat, lon) || '' };
          toast(e.location.name ? `Location: ${e.location.name}` : 'Location saved'); paintMeta(); changed(); pop.dataset.open = 'loc'; locPop();
        }, (err) => toast(err.code === 1 ? 'Location permission is off for Daybook' : 'Could not get a location fix'), { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
        break;
      case 'loc-ok': e.location.name = $('#loc-name', el).value.trim(); paintMeta(); changed(); showPop(''); break;
      case 'loc-rm': e.location = null; paintMeta(); changed(); showPop(''); break;
      case 'prompt': {
        if (pop.dataset.open === 'prompt') { pop.dataset.open = ''; showPop(''); break; }
        pop.dataset.open = 'prompt';
        const picks = [...PROMPTS].sort(() => Math.random() - 0.5).slice(0, 3);
        showPop(`<h4>Prompts</h4><div class="prompt-list">${picks.map((p) => `<button data-prompt="${esc(p)}">${esc(p)}</button>`).join('')}</div>
          <h4 style="margin-top:12px">Templates</h4><div class="chips">${TEMPLATES.map((t, i) => `<button class="chip" data-tpl="${i}">${esc(t.name)}</button>`).join('')}</div>`);
        break;
      }
    }
  });
  function insertText(t) {
    const s = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + t + ta.value.slice(ta.selectionEnd ?? s);
    e.text = ta.value; grow(); changed(); ta.focus();
  }
}

/* ---------- backup / export / import ---------- */
async function buildBackup() {
  const zip = new JSZip(); const photosDir = zip.folder('photos');
  const recs = new Map((await DB.all('photos')).map((p) => [p.id, p]));
  const byJ = new Map(); let nPhotos = 0;
  for (const e of S.entries.filter((x) => !x.deleted).sort((a, b) => new Date(a.created) - new Date(b.created))) {
    const photos = [];
    (e.photos || []).forEach((pid, i) => {
      const p = recs.get(pid); if (!p) return;
      const bytes = new Uint8Array(p.data); const h = p.md5 || md5(bytes);
      const ext = (p.type.split('/')[1] || 'jpeg').replace('jpg', 'jpeg');
      photosDir.file(`${h}.${ext}`, bytes, { compression: 'STORE' }); nPhotos++;
      photos.push({ identifier: pid, md5: h, type: ext, width: p.w, height: p.h, orderInEntry: i });
    });
    let text = e.text;
    if (photos.length) text += (text ? '\n\n' : '') + photos.map((p) => `![](dayone-moment://${p.identifier})`).join('\n');
    const o = { uuid: e.id, creationDate: isoZ(e.created), modifiedDate: isoZ(e.modified || e.created), timeZone: e.tz || TZ,
      text, tags: e.tags || [], starred: !!e.starred, daybook: { journal: e.journal, mood: e.mood || null } };
    if (e.location) o.location = { latitude: e.location.lat, longitude: e.location.lon, placeName: e.location.name || '' };
    if (e.weather) o.weather = { temperatureCelsius: e.weather.tempC, conditionsDescription: e.weather.desc };
    if (photos.length) o.photos = photos;
    if (!byJ.has(e.journal)) byJ.set(e.journal, []); byJ.get(e.journal).push(o);
  }
  const used = new Set();
  for (const [jid, entries] of byJ) {
    let base = jname(jid).replace(/[\\/:*?"<>|]/g, '-') || 'Journal'; let name = base, k = 2;
    while (used.has(name.toLowerCase())) name = `${base} ${k++}`; used.add(name.toLowerCase());
    zip.file(`${name}.json`, JSON.stringify({ metadata: { version: '1.0', app: 'Daybook ' + APP_VERSION },
      daybook: { journal: S.journals.find((j) => j.id === jid) || { id: jid, name } }, entries }, null, 2), { compression: 'DEFLATE' });
  }
  zip.file('daybook-journals.json', JSON.stringify({ journals: S.journals }), { compression: 'DEFLATE' });
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return { blob, entries: [...byJ.values()].reduce((n, a) => n + a.length, 0), photos: nPhotos };
}

function buildMarkdown() {
  const list = S.entries.filter((e) => !e.deleted).sort((a, b) => new Date(a.created) - new Date(b.created));
  let out = `# Daybook export\n\nExported ${fmtLong(new Date())}. ${list.length} entries.\n`;
  for (const e of list) {
    const d = new Date(e.created);
    out += `\n---\n\n## ${fmtLong(d)}, ${fmtTime(d)}\n\n`;
    const meta = [S.journals.length > 1 ? `Journal: ${jname(e.journal)}` : '', e.mood ? `Mood: ${MOOD_NAMES[e.mood - 1]}` : '',
      e.location ? `Place: ${e.location.name || `${e.location.lat.toFixed(4)}, ${e.location.lon.toFixed(4)}`}` : '',
      e.tags && e.tags.length ? `Tags: ${e.tags.map((t) => '#' + t).join(' ')}` : '', e.starred ? 'Starred' : '',
      e.photos && e.photos.length ? `${e.photos.length} photo(s) (in the full backup)` : ''].filter(Boolean);
    if (meta.length) out += `*${meta.join(' · ')}*\n\n`;
    out += e.text.trim() + '\n';
  }
  return new Blob([out], { type: 'text/markdown' });
}

function offerFile(blob, name, detail, onSaved) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const url = URL.createObjectURL(blob);
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Ready to save</div><span style="min-width:64px"></span></header>
    <div class="scroll"><div class="card" style="padding:16px">
      <p style="margin:0 0 4px;font-weight:600">${esc(name)}</p><p class="note" style="margin:0 0 14px">${esc(detail)} · ${fmtBytes(blob.size)}</p>
      ${canShare ? `<button class="btn" style="width:100%" data-a="share">${ic('share')} Save to Files or share…</button>` : ''}
      <a class="btn ghost" style="display:block;text-align:center;text-decoration:none;margin-top:10px" href="${url}" download="${esc(name)}" data-a="dl">Download</a>
      <p class="note" style="margin-top:14px">On iPhone, choose <b>Save to Files</b> and pick iCloud Drive or Google Drive so the copy lives off this phone.</p>
    </div></div>`);
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') { URL.revokeObjectURL(url); el.remove(); }
    if (a.dataset.a === 'share') {
      try { await navigator.share({ files: [file], title: name }); onSaved && onSaved(); toast('Saved'); }
      catch (err) { if (err.name !== 'AbortError') toast('Sharing failed; try Download'); }
    }
    if (a.dataset.a === 'dl') { onSaved && onSaved(); }
  });
}

async function doBackup() {
  toast('Building backup…', 20000);
  try {
    const { blob, entries, photos } = await buildBackup();
    const d = new Date(); const name = `Daybook-backup-${dayKey(d)}.zip`;
    toast('Backup ready', 1200);
    offerFile(blob, name, `${entries} entries, ${photos} photos`, async () => {
      S.lastBackup = new Date().toISOString(); await DB.setMeta('lastBackup', S.lastBackup); render();
    });
  } catch (err) { toast('Backup failed: ' + err.message, 5000); }
}

async function importFile(file) {
  const jsons = []; let zip = null; let journalsFile = null;
  if (/\.zip$/i.test(file.name) || /zip/.test(file.type)) {
    zip = await JSZip.loadAsync(file);
    for (const [path, f] of Object.entries(zip.files)) {
      if (f.dir || !/\.json$/i.test(path) || path.startsWith('__MACOSX') || /(^|\/)\._/.test(path)) continue;
      const data = JSON.parse(await f.async('string'));
      if (/daybook-journals\.json$/i.test(path)) { journalsFile = data; continue; }
      jsons.push({ name: path.split('/').pop().replace(/\.json$/i, ''), data });
    }
  } else {
    jsons.push({ name: file.name.replace(/\.json$/i, ''), data: JSON.parse(await file.text()) });
  }
  if (journalsFile && Array.isArray(journalsFile.journals)) {
    for (const j of journalsFile.journals) if (!S.journals.some((x) => x.id === j.id)) S.journals.push({ id: j.id, name: j.name });
  }
  const r = { added: 0, updated: 0, skipped: 0, photos: 0, missing: 0 };
  const ensureJournal = (name) => {
    let j = S.journals.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!j) { j = { id: uuid(), name }; S.journals.push(j); }
    return j.id;
  };
  for (const { name, data } of jsons) {
    if (!data || !Array.isArray(data.entries)) continue;
    let fileJournal = data.daybook && data.daybook.journal;
    if (fileJournal && !S.journals.some((x) => x.id === fileJournal.id)) S.journals.push({ id: fileJournal.id, name: fileJournal.name });
    const defaultJ = fileJournal ? fileJournal.id : ensureJournal(name);
    for (const de of data.entries) {
      const id = de.uuid || uuid();
      const created = de.creationDate || new Date().toISOString();
      const modified = de.modifiedDate || created;
      const ex = S.entries.find((x) => x.id === id);
      if (ex && ex.modified && new Date(ex.modified) >= new Date(modified)) { r.skipped++; continue; }
      let text = String(de.text || '')
        .replace(/!\[[^\]]*\]\(dayone-moment:\/*[^)]*\)\n?/g, '')
        .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1').trim();
      const photoIds = [];
      for (const p of de.photos || []) {
        const f = zip && p.md5 ? zip.file(new RegExp(`(^|/)photos/${p.md5}\\.[a-z0-9]+$`, 'i'))[0] : null;
        if (!f) { r.missing++; continue; }
        const bytes = await f.async('uint8array'); const ext = f.name.split('.').pop().toLowerCase();
        const type = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        const rec = { id: p.identifier || uuid(), type, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          w: p.width, h: p.height, md5: p.md5, created };
        try { const { im, u } = await loadImg(new Blob([bytes], { type })); rec.thumb = (await scaleTo(im, 360, 0.72)).buf; URL.revokeObjectURL(u); } catch (_) { /* thumbnail optional */ }
        await DB.put('photos', rec); photoIds.push(rec.id); r.photos++;
      }
      const loc = de.location && de.location.latitude != null ? { lat: de.location.latitude, lon: de.location.longitude,
        name: de.location.placeName || [de.location.localityName, de.location.administrativeArea].filter(Boolean).join(', ') } : null;
      const w = de.weather ? { tempC: de.weather.temperatureCelsius ?? null, desc: de.weather.conditionsDescription || '' } : null;
      const entry = { id, journal: (de.daybook && de.daybook.journal) || defaultJ, created, modified, tz: de.timeZone || TZ, text,
        tags: Array.isArray(de.tags) ? de.tags : [], mood: (de.daybook && de.daybook.mood) || null, starred: !!de.starred,
        location: loc, weather: w, photos: photoIds, deleted: null };
      if (ex) { await deletePhotos((ex.photos || []).filter((p) => !photoIds.includes(p))); r.updated++; } else r.added++;
      await DB.put('entries', entry);
      const i = S.entries.findIndex((x) => x.id === id); if (i >= 0) S.entries[i] = entry; else S.entries.push(entry);
    }
  }
  await DB.setMeta('journals', S.journals);
  return r;
}

/* ---------- settings ---------- */
async function openSettings() {
  const el = sheet('');
  const paint = async () => {
    const all = S.entries.filter((e) => !e.deleted); const st = computeStats(all);
    const trash = S.entries.filter((e) => e.deleted);
    const first = all.length ? new Date(Math.min(...all.map((e) => new Date(e.created)))) : null;
    let est = null, persisted = null;
    try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (_) {}
    try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (_) {}
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    el.innerHTML = `<header><span style="min-width:64px"></span><div class="ttl">Settings</div><button class="txtbtn r" data-a="x">Done</button></header>
    <div class="scroll">
      ${!standalone ? `<div class="banner">${ic('share')}<span>Install: tap Share, then <b>Add to Home Screen</b>. Installed, Daybook works offline and your entries are protected from Safari's storage cleanup.</span></div>` : ''}
      <div class="stats"><div class="card"><b>${st.entries}</b><small>entries</small></div><div class="card"><b>${st.days}</b><small>days</small></div><div class="card"><b>${st.photos}</b><small>photos</small></div></div>
      <p class="note">${first ? `Journaling since ${esc(fmtShort(first))}. ` : ''}${st.words.toLocaleString()} words. Current streak ${st.streak} day${st.streak === 1 ? '' : 's'}.</p>

      <div class="group"><h3>Journals</h3><div class="card">
        ${S.journals.map((j) => { const n = all.filter((e) => e.journal === j.id).length; return `<button data-rename="${j.id}">${ic('book')}${esc(j.name)}<span class="sub">${n} · Rename</span></button>`; }).join('')}
        <button data-a="add-j">${ic('plus')}New journal</button></div></div>

      <div class="group"><h3>Backup and export</h3><div class="card">
        <button data-a="backup">${ic('db')}Back up now<span class="sub">${S.lastBackup ? 'Last ' + esc(fmtShort(new Date(S.lastBackup))) : 'Never'}</span></button>
        <button data-a="md">${ic('doc')}Export as Markdown</button>
        <label style="cursor:pointer">${ic('in')}Import backup or Day One export<input type="file" accept=".zip,.json,application/zip,application/json" hidden id="imp"></label>
      </div><p class="note">The backup is a .zip in Day One's export format (JSON plus a photos folder), so it restores here or imports into Day One.</p></div>

      <div class="group"><h3>Privacy</h3><div class="card">
        <button data-a="lock">${ic('lock')}${S.lock ? 'Change passcode' : 'Set a passcode'}</button>
        ${S.lock ? `<label>${ic('clock')}Lock after<select id="lock-after" class="sub" style="border:0;background:transparent">
          ${[[0, 'Immediately'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes']].map(([v, t]) => `<option value="${v}" ${S.lockAfter === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <button data-a="unlock-off" style="color:var(--danger)">${ic('lock')}Turn off passcode</button>` : ''}
      </div><p class="note">The passcode is a privacy screen for someone holding your unlocked phone. It does not encrypt the data. If you forget it, the only way in is deleting the app, which erases everything not in a backup.</p></div>

      <div class="group"><h3>Recently deleted</h3><div class="card">
        ${trash.length ? trash.sort((a, b) => new Date(b.deleted) - new Date(a.deleted)).map((e) => `<div>${esc((titleSnip(e.text).title || 'Untitled').slice(0, 40))}<span class="sub"><button style="color:var(--accent);font-weight:600" data-restore="${e.id}">Restore</button> · <button style="color:var(--danger)" data-purge="${e.id}">Delete</button></span></div>`).join('')
          : `<div style="color:var(--muted)">Nothing here. Deleted entries stay 30 days.</div>`}
      </div></div>

      <div class="group"><h3>Storage</h3><div class="card">
        <div>${ic('db')}On this phone<span class="sub">${est && est.usage != null ? fmtBytes(est.usage) + ' used' : 'Unknown'}</span></div>
        <div>${ic('lock')}Protected from cleanup<span class="sub">${persisted === true ? 'Yes' : standalone ? 'Home Screen app' : 'No: add to Home Screen'}</span></div>
      </div></div>
      <p class="note" style="text-align:center;margin:22px 0">Daybook ${APP_VERSION} · works offline · no account, no tracking, no network calls</p>
    </div>`;
  };
  await paint();
  el.addEventListener('change', async (ev) => {
    if (ev.target.id === 'lock-after') { S.lockAfter = +ev.target.value; await DB.setMeta('lockAfter', S.lockAfter); toast('Saved'); }
    if (ev.target.id === 'imp') {
      const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
      toast('Importing…', 60000);
      try {
        const r = await importFile(f);
        toast(`Imported ${r.added} new, ${r.updated} updated, ${r.skipped} unchanged; ${r.photos} photos${r.missing ? `, ${r.missing} missing` : ''}`, 6000);
        render(); await paint();
      } catch (err) { toast('Import failed: ' + err.message, 6000); }
    }
  });
  el.addEventListener('click', async (ev) => {
    const rn = ev.target.closest('[data-rename]');
    if (rn) { const j = S.journals.find((x) => x.id === rn.dataset.rename); const n = prompt('Journal name', j.name); if (n && n.trim()) { j.name = n.trim(); await DB.setMeta('journals', S.journals); render(); await paint(); } return; }
    const rs = ev.target.closest('[data-restore]');
    if (rs) { const e = S.entries.find((x) => x.id === rs.dataset.restore); e.deleted = null; await saveEntry(e); render(); await paint(); toast('Restored'); return; }
    const pg = ev.target.closest('[data-purge]');
    if (pg) { if (!confirm('Delete this entry permanently? This cannot be undone.')) return; await hardDelete(S.entries.find((x) => x.id === pg.dataset.purge)); await paint(); return; }
    const a = ev.target.closest('[data-a]'); if (!a) return;
    switch (a.dataset.a) {
      case 'x': el.remove(); render(); break;
      case 'add-j': { const n = prompt('Name for the new journal'); if (n && n.trim()) { S.journals.push({ id: uuid(), name: n.trim() }); await DB.setMeta('journals', S.journals); render(); await paint(); } break; }
      case 'backup': await doBackup(); break;
      case 'md': offerFile(buildMarkdown(), `Daybook-${dayKey(new Date())}.md`, 'All entries as readable text'); break;
      case 'lock': { if (S.lock && !(await passcodeFlow('verify'))) break; const code = await passcodeFlow('set'); if (code) { await setPasscode(code); toast('Passcode on'); await paint(); } break; }
      case 'unlock-off': { const ok = await passcodeFlow('verify'); if (ok) { S.lock = null; await DB.setMeta('lock', null); toast('Passcode off'); await paint(); } break; }
    }
  });
}

/* ---------- passcode ---------- */
async function hashCode(code, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)), iterations: 150000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
async function setPasscode(code) {
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  S.lock = { salt, hash: await hashCode(code, salt) }; await DB.setMeta('lock', S.lock);
}
function passcodeFlow(mode) { // 'unlock' | 'verify' | 'set'
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.id = 'lock';
    let code = '', first = null;
    const title = () => mode === 'set' ? (first ? 'Enter it again' : 'Choose a 4-digit passcode') : 'Enter passcode';
    el.innerHTML = `${ic('lock')}<h2 id="lk-t">${title()}</h2><div class="dots" id="lk-d"></div>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
      <button data-k="c" style="font-size:15px;background:none">${mode === 'unlock' ? '' : 'Cancel'}</button><button data-k="0">0</button><button data-k="b" style="font-size:22px;background:none">⌫</button></div>`;
    document.body.appendChild(el);
    const dots = () => { $('#lk-d', el).innerHTML = [0, 1, 2, 3].map((i) => `<i class="${i < code.length ? 'f' : ''}"></i>`).join(''); };
    const fail = (msg) => { $('#lk-t', el).textContent = msg; const d = $('#lk-d', el); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); code = ''; dots(); };
    dots();
    el.addEventListener('click', async (ev) => {
      const k = ev.target.closest('[data-k]'); if (!k) return;
      const v = k.dataset.k;
      if (v === 'c') { if (mode !== 'unlock') { el.remove(); resolve(null); } return; }
      if (v === 'b') { code = code.slice(0, -1); dots(); return; }
      if (code.length >= 4) return;
      code += v; dots();
      if (code.length < 4) return;
      if (mode === 'set') {
        if (!first) { first = code; code = ''; $('#lk-t', el).textContent = title(); dots(); return; }
        if (code === first) { el.remove(); resolve(code); } else { first = null; fail("Didn't match. Choose a passcode"); }
        return;
      }
      const ok = (await hashCode(code, S.lock.salt)) === S.lock.hash;
      if (ok) { el.remove(); resolve(true); } else fail('Wrong passcode');
    });
  });
}
async function lockNow() {
  if (!S.lock || S.locked) return;
  S.locked = true; await passcodeFlow('unlock'); S.locked = false;
}

/* ---------- wiring ---------- */
function wire() {
  $$('nav.tabs button').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; main().scrollTop = 0; main().innerHTML = ''; render(); }));
  $('#btn-new').addEventListener('click', () => openEditor(null, S.view === 'calendar' && S.calSel !== dayKey(new Date()) ? S.calSel : null));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#journal-filter').addEventListener('change', (ev) => { S.filter = ev.target.value; main().innerHTML = ''; render(); });
  main().addEventListener('click', (ev) => {
    const o = ev.target.closest('[data-open]'); if (o) return openReader(o.dataset.open);
    const day = ev.target.closest('[data-day]'); if (day) { S.calSel = day.dataset.day; return render(); }
    const tag = ev.target.closest('[data-tag]');
    if (tag) { const t = tag.dataset.tag; S.search.tags.has(t) ? S.search.tags.delete(t) : S.search.tags.add(t); return renderSearchResults(); }
    const a = ev.target.closest('[data-act]'); if (!a) return;
    switch (a.dataset.act) {
      case 'more': S.limit += 200; render(); break;
      case 'prev': S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() - 1, 1); render(); break;
      case 'next': S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() + 1, 1); render(); break;
      case 'write-day': openEditor(null, S.calSel); break;
      case 'f-star': S.search.starred = !S.search.starred; renderSearchResults(); break;
      case 'backup': doBackup(); break;
      case 'update': if (S.updateReady) { S.updateReady.postMessage('skipWaiting'); } break;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.hiddenAt = Date.now();
    else if (S.lock && Date.now() - S.hiddenAt >= S.lockAfter * 60000) lockNow();
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const watch = (w) => w && w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) { S.updateReady = w; render(); }
    });
    if (reg.waiting && navigator.serviceWorker.controller) { S.updateReady = reg.waiting; render(); }
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.updateReady && !reloaded) { reloaded = true; location.reload(); } });
}

(async function init() {
  try {
    await DB.open(); await loadAll(); await purgeTrash();
    wire(); render(); registerSW();
    if (S.lock) lockNow();
  } catch (err) {
    document.body.innerHTML = `<div class="empty"><h2>Daybook could not open its storage</h2><p>${esc(err.message)}</p><p>If this is a Private Browsing tab, open Daybook in a normal tab or from the Home Screen.</p></div>`;
  }
})();
