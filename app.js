/* Daybook: a private, offline journal. All data lives in this device's IndexedDB. */
'use strict';

const APP_VERSION = '1.3.2';

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
const wordCount = (t) => (stripMoments(t).match(/\S+/g) || []).length;
const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); return fn(...a); }; f.cancel = () => clearTimeout(t); return f; };
const IS_IPAD = /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const IS_MAC = /Macintosh/.test(navigator.userAgent) && !IS_IPAD;
const IS_IPHONE = /iPhone|iPod/.test(navigator.userAgent);
const DEVICE = IS_MAC ? 'Mac' : IS_IPAD ? 'iPad' : IS_IPHONE ? 'iPhone' : /Windows/.test(navigator.userAgent) ? 'PC' : /Android/.test(navigator.userAgent) ? 'phone' : 'computer';
const HERE = IS_IPHONE || /Android/.test(navigator.userAgent) ? 'this phone' : 'this ' + DEVICE;
const POINTER = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const TAP = POINTER ? 'Click' : 'Tap', tap = POINTER ? 'click' : 'tap';
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
  lock: null, lockAfter: 1, lastBackup: null, autoTag: true, mapTag: '', map: null, hiddenAt: 0, locked: false, updateReady: null,
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
  S.autoTag = await DB.meta('autoTag', true);
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
  const exif = readExif(await blob.arrayBuffer()); // read before re-encoding, which drops EXIF
  const { im, u } = await loadImg(blob);
  try {
    const full = await scaleTo(im, 2048, 0.85), th = await scaleTo(im, 360, 0.72);
    return { rec: { id: uuid(), type: 'image/jpeg', data: full.buf, thumb: th.buf, w: full.w, h: full.h,
      md5: md5(new Uint8Array(full.buf)), created: new Date().toISOString() }, exif };
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
async function hardDelete(e, tomb = true) {
  await deletePhotos(e.photos); await DB.del('entries', e.id);
  S.entries = S.entries.filter((x) => x.id !== e.id);
  // remember the deletion for a year so a sync file can remove the entry on the other device too
  if (tomb) {
    const cut = Date.now() - 365 * 864e5;
    const t = (await DB.meta('tombstones', [])).filter((x) => x.id !== e.id && new Date(x.at).getTime() > cut);
    t.push({ id: e.id, at: new Date().toISOString() }); await DB.setMeta('tombstones', t);
  }
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
/* Inline photos use Day One's marker syntax on a line of their own: ![](dayone-moment://ID) */
const MOMENT_RE = /!\[[^\]]*\]\(dayone-moment:\/\/([A-Za-z0-9_-]+)\)/g;
const MOMENT_LINE = /^!\[[^\]]*\]\(dayone-moment:\/\/([A-Za-z0-9_-]+)\)$/;
function stripMoments(t) { return String(t || '').replace(/[ \t]*!\[[^\]]*\]\(dayone-moment:\/*[^)]*\)[ \t]*\n?/g, ''); }
function toBlocks(e) {
  const raw = [], seen = new Set(), valid = new Set(e.photos || []); let buf = [];
  const flush = () => { raw.push({ t: 'text', v: buf.join('\n').replace(/^\n+|\n+$/g, '') }); buf = []; };
  for (const ln of String(e.text || '').split('\n')) {
    const m = ln.trim().match(MOMENT_LINE);
    if (m) { if (valid.has(m[1]) && !seen.has(m[1])) { flush(); raw.push({ t: 'photo', id: m[1] }); seen.add(m[1]); } }
    else buf.push(ln);
  }
  flush();
  for (const id of e.photos || []) if (!seen.has(id)) raw.push({ t: 'photo', id }); // older entries: photos go after the text
  const out = [];
  for (const b of raw) {
    if (b.t === 'text' && out.length && out[out.length - 1].t === 'text') { const a = out[out.length - 1]; a.v = [a.v, b.v].filter((x) => x.trim()).join('\n\n'); continue; }
    if (b.t === 'photo' && (!out.length || out[out.length - 1].t === 'photo')) out.push({ t: 'text', v: '' });
    out.push(b);
  }
  if (!out.length || out[out.length - 1].t === 'photo') out.push({ t: 'text', v: '' });
  return out;
}
function fromBlocks(blocks) {
  const parts = [], photos = [];
  for (const b of blocks) {
    if (b.t === 'photo') { parts.push(`![](dayone-moment://${b.id})`); photos.push(b.id); }
    else if (b.v.trim()) parts.push(b.v.replace(/^\n+|\n+$/g, ''));
  }
  return { text: parts.join('\n\n'), photos };
}
const plain = (s) => stripMoments(s).replace(/^#{1,3}\s+/gm, '').replace(/[*_`>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
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
  if (!n) return '';
  const age = S.lastBackup ? (Date.now() - new Date(S.lastBackup)) / 864e5 : Infinity;
  if (age < 14) return '';
  const when = S.lastBackup ? `Last backup ${Math.floor(age)} days ago.` : 'Not backed up yet.';
  return `<div class="banner">${ic('db')}<span>${when} Your journal lives only on ${HERE}.</span><button data-act="backup">Back up</button></div>`;
}

/* ---------- main views ---------- */
const main = () => $('#main');
// the update notice floats above every tab and panel, so it can't be missed
function showUpdate() {
  if (!S.updateReady || S.updateLater || $('#upd')) return;
  const b = document.createElement('div'); b.id = 'upd'; b.className = 'banner';
  b.innerHTML = `${ic('in')}<span>A new version of Daybook is ready.</span><button data-go>Reload</button><button data-later aria-label="Later" style="margin-left:4px;font-size:20px;color:var(--muted)">×</button>`;
  $('[data-later]', b).addEventListener('click', () => { b.remove(); S.updateLater = true; }); // shows again next time Daybook opens
  $('[data-go]', b).addEventListener('click', async () => {
    const ed = $$('.sheet').find((x) => x._done); if (ed) { ed._done(); await new Promise((r) => setTimeout(r, 300)); } // save an open entry first
    $('[data-go]', b).textContent = 'Updating…'; S.updateReady.postMessage('skipWaiting');
    setTimeout(() => location.reload(), 4000); // in case the switch-over event never arrives
  });
  document.body.appendChild(b);
}
function render() {
  showUpdate();
  if (S.map) { try { S.map.remove(); } catch (_) { /* already gone */ } S.map = null; }
  const titles = { timeline: 'Journal', calendar: 'Calendar', media: 'Photos', map: 'Map', search: 'Search' };
  $('#view-title').textContent = S.filter !== 'all' && S.view === 'timeline' ? jname(S.filter) : titles[S.view];
  $$('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  const sel = $('#journal-filter');
  sel.innerHTML = `<option value="all">All journals</option>` + S.journals.map((j) => `<option value="${j.id}">${esc(j.name)}</option>`).join('');
  sel.value = S.filter; sel.parentElement.classList.toggle('hidden', S.journals.length < 2);
  ({ timeline: renderTimeline, calendar: renderCalendar, media: renderMedia, map: renderMap, search: renderSearch })[S.view]();
}

function renderTimeline() {
  const list = live(); let h = backupBanner();
  if (!list.length) {
    h += `<div class="empty"><h2>Nothing written yet</h2><p>${TAP} + to start${POINTER ? ' (or press N)' : ''}. Entries, photos and everything else stay on ${HERE} and work with no signal.</p></div>`;
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
    && (!ql || stripMoments(e.text).toLowerCase().includes(ql) || (e.tags || []).some((t) => t.toLowerCase().includes(ql)) || (e.location && (e.location.name || '').toLowerCase().includes(ql))));
  const active = q || S.search.starred || S.search.tags.size;
  $('#search-res').innerHTML = !active ? `<p class="note">Search words, tags and places. ${TAP} a tag to filter.</p>`
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
      <div class="md">${toBlocks(e).map((b) => { if (b.t !== 'photo') return b.v.trim() ? md(b.v) : ''; const m = (e.photoMeta || {})[b.id]; return `<figure class="rf"><img class="inl" data-photo="${b.id}" alt="">${m && m.lat != null ? `<figcaption>${ic('pin')}${esc(m.name || `${m.lat.toFixed(4)}, ${m.lon.toFixed(4)}`)}</figcaption>` : ''}</figure>`; }).join('') || '<p style="color:var(--muted)">No text.</p>'}</div>
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
      <div class="ttl" style="position:relative"><span id="ed-when"></span><small>${TAP} to change date</small>
        <input type="datetime-local" id="ed-date" style="position:absolute;inset:0;opacity:0;width:100%" aria-label="Entry date"></div>
      <button class="txtbtn r" data-a="done">Done</button></header>
    <div class="scroll"><div class="ed-meta" id="ed-meta"></div><div id="ed-body"></div></div>
    <div id="ed-pop"></div>
    <div class="toolbar">
      <label aria-label="Add photos">${ic('camera')}Photo<input type="file" accept="image/*" multiple hidden id="ed-file"></label>
      <button data-a="tags" aria-label="Tags">${ic('tag')}Tags</button>
      <button data-a="mood" aria-label="Mood">${ic('smile')}Mood</button>
      <button data-a="loc" aria-label="Location">${ic('pin')}Place</button>
      <button data-a="star" aria-label="Star">${ic('star')}Star</button>
      <button data-a="prompt" aria-label="Prompts and templates">${ic('bulb')}Ideas</button>
    </div>`);
  const pop = $('#ed-pop', el), body = $('#ed-body', el);
  let blocks = toBlocks(e), lastTA = null;
  const sync = () => {
    const r = fromBlocks(blocks); e.text = r.text; e.photos = r.photos;
    if (e.photoMeta) for (const k of Object.keys(e.photoMeta)) if (!e.photos.includes(k)) delete e.photoMeta[k];
  };
  const phLabel = (id) => { const m = (e.photoMeta || {})[id]; return m && m.lat != null ? esc(m.name || 'Placed') : 'Add place'; };
  const growTA = (ta) => {
    const i = +ta.dataset.i; ta.style.height = 'auto';
    const min = blocks.length === 1 ? window.innerHeight * 0.45 : i === blocks.length - 1 ? 140 : 34;
    ta.style.height = Math.max(ta.scrollHeight, min) + 'px';
  };
  const paintBody = (focusIdx, caret) => {
    body.innerHTML = blocks.map((b, i) => b.t === 'photo'
      ? `<div class="ph-inl"><img data-photo="${b.id}" alt=""><button class="pl ${(e.photoMeta || {})[b.id] && e.photoMeta[b.id].lat != null ? 'on' : ''}" data-phloc="${b.id}" aria-label="Photo location">${ic('pin')}<span>${phLabel(b.id)}</span></button><button class="x" data-rm="${b.id}" aria-label="Remove photo">×</button></div>`
      : `<textarea class="ed-text" data-i="${i}" rows="1" placeholder="${i === 0 ? "What's on your mind?" : i === blocks.length - 1 ? 'Keep writing…' : 'Add text'}"></textarea>`).join('');
    $$('textarea', body).forEach((ta) => { ta.value = blocks[+ta.dataset.i].v; growTA(ta); });
    hydrate(body);
    lastTA = null;
    if (focusIdx != null) { const ta = $(`textarea[data-i="${focusIdx}"]`, body); if (ta) { ta.focus(); if (caret != null) ta.setSelectionRange(caret, caret); lastTA = ta; } }
  };
  body.addEventListener('input', (ev) => {
    const ta = ev.target.closest('textarea'); if (!ta) return;
    blocks[+ta.dataset.i].v = ta.value; growTA(ta); lastTA = ta; sync(); changed();
  });
  body.addEventListener('focusin', (ev) => { if (ev.target.matches('textarea')) lastTA = ev.target; });
  const insertPhotos = (ids) => {
    let i, pos;
    if (lastTA && body.contains(lastTA)) { i = +lastTA.dataset.i; pos = lastTA.selectionStart ?? lastTA.value.length; }
    else { i = blocks.length - 1; pos = blocks[i].v.length; }
    const v = blocks[i].v, mid = [];
    ids.forEach((id, k) => { if (k) mid.push({ t: 'text', v: '' }); mid.push({ t: 'photo', id }); });
    blocks.splice(i, 1, { t: 'text', v: v.slice(0, pos).replace(/\s+$/, '') }, ...mid, { t: 'text', v: v.slice(pos).replace(/^\s+/, '') });
    sync(); paintBody(i + mid.length + 1, 0);
  };
  const removePhoto = (id) => {
    const k = blocks.findIndex((b) => b.t === 'photo' && b.id === id); if (k < 0) return;
    const prev = blocks[k - 1], next = blocks[k + 1], caret = prev.v.length;
    prev.v = [prev.v, next.v].filter((x) => x.trim()).join('\n\n');
    blocks.splice(k, 2); sync(); paintBody(k - 1, caret);
  };

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
  paintWhen(); paintMeta(); paintBody();
  if (isNew) { const f0 = () => { const t0 = $('textarea', body); if (t0) { t0.focus(); lastTA = t0; } }; if (POINTER) f0(); else setTimeout(f0, 250); }

  $('#ed-file', el).addEventListener('change', (ev) => { const files = [...ev.target.files]; ev.target.value = ''; addFiles(files); });
  // on a Mac: drag photos from Finder or Photos onto the entry, or paste one
  el.addEventListener('dragover', (ev) => { if ([...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', (ev) => { if (ev.target === el || !el.contains(ev.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (ev) => {
    el.classList.remove('drop'); const files = [...ev.dataTransfer.files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|gif|webp)$/i.test(f.name));
    if (!ev.dataTransfer.files.length) return; ev.preventDefault();
    const ta = ev.target.closest && ev.target.closest('textarea'); if (ta) lastTA = ta;
    if (files.length) addFiles(files); else toast('Only photos can be added');
  });
  el.addEventListener('paste', (ev) => {
    const files = [...(ev.clipboardData && ev.clipboardData.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { ev.preventDefault(); addFiles(files); }
  });
  el._done = () => $('[data-a=done]', el).click();
  async function addFiles(files) {
    if (!files.length) return;
    toast(`Adding ${files.length} photo${files.length > 1 ? 's' : ''}…`);
    const ids = [], here = [];
    e.photoMeta = e.photoMeta || {};
    for (const f of files) {
      try {
        const { rec, exif } = await makePhoto(f); await DB.put('photos', rec); ids.push(rec.id);
        const m = { taken: exif.taken || null };
        if (exif.lat != null) Object.assign(m, { lat: exif.lat, lon: exif.lon, src: 'photo', name: nearestPlaceName(exif.lat, exif.lon) || '' });
        else if (S.autoTag) { const t = m.taken ? new Date(m.taken).getTime() : f.lastModified; if (t && Math.abs(Date.now() - t) < 30 * 60000) here.push(rec.id); }
        e.photoMeta[rec.id] = m;
      } catch (err) { toast(err.message); }
    }
    if (!ids.length) return;
    insertPhotos(ids); dirty = true; await persist();
    if (here.length) {
      // a photo taken just now has no GPS in it (iPhone strips it), so tag it with where the phone is
      try {
        const pos = await getPosition(), name = nearestPlaceName(pos.lat, pos.lon) || '';
        for (const id of here) if (e.photoMeta[id]) Object.assign(e.photoMeta[id], { lat: pos.lat, lon: pos.lon, src: 'device', name });
        repaintPhotoTags(); dirty = true; await persist();
      } catch (_) { /* no location: the photo simply stays unplaced */ }
    }
  }

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
  const nearestName = nearestPlaceName;
  let curPh = null;
  const repaintPhotoTags = () => $$('[data-phloc]', body).forEach((btn) => {
    const m = (e.photoMeta || {})[btn.dataset.phloc]; btn.classList.toggle('on', !!(m && m.lat != null)); $('span', btn).innerHTML = phLabel(btn.dataset.phloc);
  });
  const phLocPop = (id) => {
    curPh = id; const m = (e.photoMeta || {})[id] || {};
    const src = m.src === 'photo' ? ' · from the photo' : m.src === 'device' ? ' · where you were when you added it' : '';
    showPop(`<h4>Photo location</h4>${m.lat != null
      ? `<div class="row"><input type="text" id="phloc-name" placeholder="Name this place" value="${esc(m.name || '')}"><button class="btn" data-a="phloc-save">Save</button></div><p class="note" style="margin:8px 0">${m.lat.toFixed(5)}, ${m.lon.toFixed(5)}${src}</p>`
      : '<p class="note" style="margin:0 0 8px">This photo has no location yet.</p>'}
      <div class="chips"><button class="chip" data-a="phloc-here">${ic('pin')} Where I am now</button>${e.location ? '<button class="chip" data-a="phloc-entry">Same as the entry</button>' : ''}${m.lat != null ? '<button class="chip" data-a="phloc-rm">Remove</button>' : ''}</div>`);
  };
  const setPhLoc = (m) => { e.photoMeta = e.photoMeta || {}; e.photoMeta[curPh] = { ...(e.photoMeta[curPh] || {}), ...m }; repaintPhotoTags(); changed(); };

  el.addEventListener('click', async (ev) => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) {
      if (!confirm('Remove this photo from the entry?')) return;
      removePhoto(rm.dataset.rm); await deletePhotos([rm.dataset.rm]); dirty = true; await persist(); return;
    }
    const pl = ev.target.closest('[data-phloc]'); if (pl) { pop.dataset.open = 'phloc'; phLocPop(pl.dataset.phloc); return; }
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
          if (isNew) await hardDelete(e, false);
          else { e.deleted = new Date().toISOString(); await saveEntry(e); const r0 = $('.sheet[data-reader]'); if (r0) r0.remove(); toast('Empty entry moved to Recently Deleted'); }
        }
        el.remove(); render(); const rd = $('.sheet[data-reader]'); if (rd) renderReader(rd);
        break;
      case 'discard':
        if (hasContent() && !confirm('Discard this entry?')) return;
        autosave.cancel(); dirty = false; await deletePhotos(e.photos);
        if (persisted) await hardDelete(e, false);
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
      case 'phloc-save': setPhLoc({ name: $('#phloc-name', el).value.trim() }); showPop(''); break;
      case 'phloc-rm': setPhLoc({ lat: null, lon: null, name: '', src: null }); showPop(''); break;
      case 'phloc-entry': setPhLoc({ lat: e.location.lat, lon: e.location.lon, name: e.location.name || '', src: 'entry' }); showPop(''); break;
      case 'phloc-here': {
        toast('Finding your location…', 8000);
        try { const p = await getPosition(); setPhLoc({ lat: p.lat, lon: p.lon, name: nearestPlaceName(p.lat, p.lon) || '', src: 'device' }); toast('Photo placed'); phLocPop(curPh); }
        catch (err) { toast(err.message); }
        break;
      }
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
    const ta = lastTA && body.contains(lastTA) ? lastTA : $('textarea', body);
    const s = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + t + ta.value.slice(ta.selectionEnd ?? s);
    blocks[+ta.dataset.i].v = ta.value; growTA(ta); sync(); changed();
    ta.focus(); ta.setSelectionRange(s + t.length, s + t.length); lastTA = ta;
  }
}

/* ---------- places: photo geotags, map, route sketch ---------- */
const ML = {
  js: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  jsSri: 'sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp',
  css: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  cssSri: 'sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK',
  style: 'https://tiles.openfreemap.org/styles/liberty',
};

/* Reads GPS position and capture time from a JPEG's EXIF block. Returns {} when there is none. */
function readExif(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xFFD8) return {};
    let off = 2;
    while (off + 10 < dv.byteLength) {
      const marker = dv.getUint16(off), len = dv.getUint16(off + 2);
      if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) return parseTiff(dv, off + 10);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      off += 2 + len;
    }
  } catch (_) { /* malformed EXIF: treat as none */ }
  return {};
}
function parseTiff(dv, t) {
  const le = dv.getUint16(t) === 0x4949;
  const u16 = (o) => dv.getUint16(t + o, le), u32 = (o) => dv.getUint32(t + o, le);
  const ifd = (o) => { const n = u16(o), tags = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = { count: u32(e + 4), at: e + 8 }; } return tags; };
  const rat = (o) => u32(o) / (u32(o + 4) || 1);
  const str = (tag) => { const o = tag.count > 4 ? u32(tag.at) : tag.at; let s = ''; for (let i = 0; i < tag.count - 1; i++) s += String.fromCharCode(dv.getUint8(t + o + i)); return s; };
  const when = (tag) => { const m = tag && str(tag).match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString() : null; };
  const out = {}, ifd0 = ifd(u32(4));
  if (ifd0[0x8769]) { const ex = ifd(u32(ifd0[0x8769].at)); out.taken = when(ex[0x9003] || ex[0x9004]); }
  if (!out.taken) out.taken = when(ifd0[0x0132]);
  if (ifd0[0x8825]) {
    const g = ifd(u32(ifd0[0x8825].at));
    const deg = (tag) => { if (!tag) return null; const o = u32(tag.at); return rat(o) + rat(o + 8) / 60 + rat(o + 16) / 3600; };
    const ref = (tag, d) => (tag ? String.fromCharCode(dv.getUint8(t + tag.at)) : d);
    const la = deg(g[2]), lo = deg(g[4]);
    if (la != null && lo != null && !(la === 0 && lo === 0)) { out.lat = ref(g[1], 'N') === 'S' ? -la : la; out.lon = ref(g[3], 'E') === 'W' ? -lo : lo; }
  }
  return out;
}

function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => rej(new Error(err.code === 1 ? 'Location permission is off for Daybook' : 'Could not get a location fix')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  });
}
function nearestPlaceName(lat, lon) {
  let best = null, bd = 250; // meters
  const test = (p) => {
    if (!p || p.lat == null || !p.name) return;
    const dy = (p.lat - lat) * 111320, dx = (p.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180);
    const dist = Math.hypot(dx, dy); if (dist < bd) { bd = dist; best = p.name; }
  };
  for (const x of S.entries) { test(x.location); for (const m of Object.values(x.photoMeta || {})) test(m); }
  return best;
}
const milesBetween = (a, b) => {
  const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
};
function captionAfter(blocks, i) {
  const next = blocks[i + 1];
  const t = next && next.t === 'text' ? plain(next.v).replace(/\s+/g, ' ').trim() : '';
  if (!t) return '';
  const first = (t.match(/^.*?[.!?](\s|$)/) || [t])[0].trim();
  return first.length > 140 ? first.slice(0, 137) + '…' : first;
}
/* Every place in these entries, oldest first: photos with their own position, then each entry's own location. */
function mapPoints(list) {
  const pts = [];
  for (const e of list) {
    const blocks = toBlocks(e), title = titleSnip(e.text).title || 'Entry', meta = e.photoMeta || {};
    let loose = null;
    blocks.forEach((b, i) => {
      if (b.t !== 'photo') return;
      const m = meta[b.id];
      if (!m || m.lat == null) { if (!loose) loose = b.id; return; }
      pts.push({ kind: 'photo', entry: e.id, anchor: 'p-' + b.id, lat: m.lat, lon: m.lon, t: m.taken || e.created,
        name: m.name || '', caption: captionAfter(blocks, i) || title, thumbId: b.id });
    });
    // skip the entry's own pin when one of its photos already marks the same spot
    const dup = e.location && pts.some((q) => q.entry === e.id && milesBetween(q, e.location) < 0.03);
    if (e.location && !dup) pts.push({ kind: 'entry', entry: e.id, anchor: 'e-' + e.id, lat: e.location.lat, lon: e.location.lon,
      t: e.created, name: e.location.name || '', caption: title, thumbId: loose });
  }
  return pts.sort((a, b) => new Date(a.t) - new Date(b.t));
}
function routeMiles(pts) { let m = 0; for (let i = 1; i < pts.length; i++) m += milesBetween(pts[i - 1], pts[i]); return m; }
/* A plain drawing of the route with no base map: works offline and in previews that don't run scripts. */
function sketchSVG(pts, W = 360, H = 420) {
  if (!pts.length) return '';
  const P = 40;
  const pr = pts.map((p) => ({ ...p, x: (p.lon + 180) / 360, y: (1 - Math.log(Math.tan(Math.PI / 4 + p.lat * Math.PI / 360)) / Math.PI) / 2 }));
  const xs = pr.map((p) => p.x), ys = pr.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min((W - 2 * P) / Math.max(x1 - x0, 1e-9), (H - 2 * P) / Math.max(y1 - y0, 1e-9));
  const X = (x) => W / 2 + (x - (x0 + x1) / 2) * s, Y = (y) => H / 2 + (y - (y0 + y1) / 2) * s;
  const seen = new Set(), labels = [];
  const X0 = (x) => W / 2 + (x - (x0 + x1) / 2) * s, Y0 = (y) => H / 2 + (y - (y0 + y1) / 2) * s;
  pr.forEach((p) => {
    // one label per place name, and none that would sit on top of another
    if (!p.name || seen.has(p.name) || labels.length >= 12) return;
    if (labels.some((q) => Math.abs(X0(q.x) - X0(p.x)) < 70 && Math.abs(Y0(q.y) - Y0(p.y)) < 16)) return;
    seen.add(p.name); labels.push(p);
  });
  const f = (n) => n.toFixed(1);
  return `<svg viewBox="0 0 ${W} ${H}" class="sk" role="img" aria-label="Route sketch">
    ${pr.length > 1 ? `<polyline points="${pr.map((p) => `${f(X(p.x))},${f(Y(p.y))}`).join(' ')}" class="sk-route"/>` : ''}
    ${pr.map((p) => `<circle cx="${f(X(p.x))}" cy="${f(Y(p.y))}" r="${p.kind === 'photo' ? 5 : 6.5}" class="sk-pt ${p.kind}"/>`).join('')}
    <circle cx="${f(X(pr[0].x))}" cy="${f(Y(pr[0].y))}" r="11" class="sk-start"/>
    ${labels.map((p) => { const x = X(p.x), right = x > W * 0.68; return `<text x="${f(right ? x - 10 : x + 10)}" y="${f(Y(p.y) + 4)}" text-anchor="${right ? 'end' : 'start'}" class="sk-lbl">${esc(p.name)}</text>`; }).join('')}
  </svg>`;
}
function loadMapLib() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loadMapLib.p) return loadMapLib.p;
  loadMapLib.p = new Promise((res, rej) => {
    const l = document.createElement('link'); Object.assign(l, { rel: 'stylesheet', href: ML.css, integrity: ML.cssSri, crossOrigin: 'anonymous' });
    const s = document.createElement('script'); Object.assign(s, { src: ML.js, integrity: ML.jsSri, crossOrigin: 'anonymous' });
    s.onload = () => res(window.maplibregl);
    s.onerror = () => { loadMapLib.p = null; rej(new Error('The map needs a connection')); };
    document.head.append(l, s);
    setTimeout(() => rej(new Error('The map took too long to load')), 20000);
  });
  return loadMapLib.p;
}
function popupHTML(p) {
  const d = new Date(p.t);
  return `<div class="pp">${p.thumbId ? `<img data-photo="${p.thumbId}" data-thumb alt="">` : ''}<b>${esc(p.caption)}</b>
    <small>${esc(fmtShort(d))}${p.name ? ' · ' + esc(p.name) : ''}</small><button data-open="${p.entry}">Open entry</button></div>`;
}
function buildLiveMap(ml, box, pts) {
  box.innerHTML = ''; box.classList.add('live');
  const map = new ml.Map({ container: box, style: ML.style, attributionControl: { compact: true } });
  map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
  const b = new ml.LngLatBounds(); pts.forEach((p) => b.extend([p.lon, p.lat]));
  map.fitBounds(b, { padding: 56, maxZoom: 14, duration: 0 });
  map.on('load', () => {
    if (pts.length < 2) return;
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) } } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c8923c', 'line-width': 3.5, 'line-dasharray': [2, 1.6] } });
  });
  for (const p of pts) {
    const el = document.createElement('div'); el.className = 'mk ' + (p.thumbId ? 'mk-ph' : 'mk-en');
    if (p.thumbId) { const img = document.createElement('img'); img.alt = ''; photoURL(p.thumbId, true).then((u) => { img.src = u; }); el.appendChild(img); }
    const pop = new ml.Popup({ offset: 24, maxWidth: '240px' }).setHTML(popupHTML(p));
    pop.on('open', () => hydrate(pop.getElement()));
    new ml.Marker({ element: el }).setLngLat([p.lon, p.lat]).setPopup(pop).addTo(map);
  }
  return map;
}
function renderMap() {
  const all = live();
  const tags = [...new Set(all.flatMap((e) => e.tags || []))].sort();
  if (S.mapTag && !tags.includes(S.mapTag)) S.mapTag = '';
  const list = S.mapTag ? all.filter((e) => (e.tags || []).includes(S.mapTag)) : all;
  const pts = mapPoints(list);
  const first = pts.length ? new Date(pts[0].t) : null, last = pts.length ? new Date(pts[pts.length - 1].t) : null;
  const miles = routeMiles(pts);
  main().innerHTML = `<div class="row" style="margin:8px 0 10px">
      ${tags.length ? `<select id="map-tag" class="field" aria-label="Show a tag"><option value="">Everything</option>${tags.map((t) => `<option value="${esc(t)}" ${t === S.mapTag ? 'selected' : ''}>#${esc(t)}</option>`).join('')}</select>` : '<span style="flex:1"></span>'}
      <button class="btn" data-act="share">${ic('share')} Share</button></div>
    ${pts.length ? `<div class="card mapbox" id="mapbox"><div class="sketch">${sketchSVG(pts)}</div></div>
      <p class="note" id="map-note">${pts.length} place${pts.length === 1 ? '' : 's'}${pts.length > 1 ? `, about ${Math.round(miles).toLocaleString()} miles of route` : ''} · ${esc(fmtShort(first))}${last - first > 864e5 ? ' to ' + esc(fmtShort(last)) : ''}</p>`
    : `<div class="empty"><h2>No places yet</h2><p>${TAP} <b>Place</b> in an entry, or add photos you take on the spot. They'll show up here, joined by your route.</p></div>`}`;
  const sel = $('#map-tag'); if (sel) sel.onchange = () => { S.mapTag = sel.value; render(); };
  if (!pts.length) return;
  if (navigator.onLine === false) { $('#map-note').insertAdjacentHTML('beforeend', '<br>Showing a sketch of the route; the full map needs a connection.'); return; }
  const box = $('#mapbox');
  loadMapLib().then((ml) => { if (box.isConnected) S.map = buildLiveMap(ml, box, pts); })
    .catch((err) => { if (box.isConnected) $('#map-note').insertAdjacentHTML('beforeend', `<br>Showing a sketch of the route. ${esc(err.message)}.`); });
}

/* ---------- share a trip as one self-contained web page ---------- */
function shareSelection(o) {
  return S.entries.filter((e) => !e.deleted && (o.journal === 'all' || e.journal === o.journal)
    && (!o.tag || (e.tags || []).includes(o.tag))
    && (!o.from || dayKey(new Date(e.created)) >= o.from) && (!o.to || dayKey(new Date(e.created)) <= o.to))
    .sort((a, b) => new Date(a.created) - new Date(b.created));
}
function openShare() {
  const all = S.entries.filter((e) => !e.deleted);
  const tags = [...new Set(all.flatMap((e) => e.tags || []))].sort();
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Cancel</button><div class="ttl">Share a trip</div><span style="min-width:64px"></span></header>
    <div class="scroll"><div class="card form">
      <label>Title<input class="field" id="sh-title" type="text"></label>
      <label>Journal<select class="field" id="sh-j"><option value="all">All journals</option>${S.journals.map((j) => `<option value="${j.id}">${esc(j.name)}</option>`).join('')}</select></label>
      ${tags.length ? `<label>Tag<select class="field" id="sh-tag"><option value="">Any</option>${tags.map((t) => `<option value="${esc(t)}">#${esc(t)}</option>`).join('')}</select></label>` : ''}
      <div class="row"><label style="flex:1">From<input class="field" type="date" id="sh-from"></label><label style="flex:1">To<input class="field" type="date" id="sh-to"></label></div>
      <label>Photo size<select class="field" id="sh-px"><option value="1280">Standard</option><option value="900">Smaller file</option></select></label>
      <label class="chk"><input type="checkbox" id="sh-map" checked> Include the map</label>
      <label class="chk"><input type="checkbox" id="sh-places" checked> Include place names</label>
    </div>
    <p class="note" id="sh-sum"></p>
    <button class="btn" style="width:100%;margin-top:6px" data-a="go">Create the page</button>
    <p class="note">This makes one web page file that opens in any browser, on any phone or computer. Moods, tags and stars stay out of it. Unlike your journal, the page leaves ${HERE} with whoever you send it to.</p></div>`);
  const $s = (id) => $('#' + id, el);
  if (S.filter !== 'all') $s('sh-j').value = S.filter;
  if ($s('sh-tag') && S.view === 'map' && S.mapTag) $s('sh-tag').value = S.mapTag;
  const opts = () => ({ journal: $s('sh-j').value, tag: $s('sh-tag') ? $s('sh-tag').value : '', from: $s('sh-from').value, to: $s('sh-to').value,
    px: +$s('sh-px').value, map: $s('sh-map').checked, places: $s('sh-places').checked, title: $s('sh-title').value.trim() });
  let titleEdited = false;
  const resetScope = () => {
    const o = opts(); o.from = ''; o.to = '';
    const list = shareSelection(o);
    $s('sh-from').value = list.length ? dayKey(new Date(list[0].created)) : '';
    $s('sh-to').value = list.length ? dayKey(new Date(list[list.length - 1].created)) : '';
    if (!titleEdited) $s('sh-title').value = o.tag ? o.tag.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) : o.journal !== 'all' ? jname(o.journal) : 'My trip';
  };
  const summary = () => {
    const o = opts(), list = shareSelection(o), photos = list.reduce((n, e) => n + (e.photos || []).length, 0);
    const mb = photos * (o.px >= 1280 ? 0.33 : 0.17) + 0.05;
    $s('sh-sum').textContent = list.length ? `${list.length} entr${list.length === 1 ? 'y' : 'ies'}, ${photos} photo${photos === 1 ? '' : 's'}, roughly ${mb < 1 ? '1' : Math.round(mb)} MB.` : 'No entries match.';
  };
  resetScope(); summary();
  el.addEventListener('input', (ev) => { if (ev.target.id === 'sh-title') titleEdited = true; });
  el.addEventListener('change', (ev) => { if (['sh-j', 'sh-tag'].includes(ev.target.id)) resetScope(); summary(); });
  el.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'x') el.remove();
    if (a.dataset.a === 'go') {
      const o = opts(); if (!shareSelection(o).length) { toast('No entries match'); return; }
      a.disabled = true;
      try {
        const { blob, entries, photos } = await buildSharePage(o);
        const name = (o.title || 'Daybook trip').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') + '.html';
        toast('Page ready', 1200); el.remove();
        offerFile(blob, name, `${entries} entr${entries === 1 ? 'y' : 'ies'}, ${photos} photo${photos === 1 ? '' : 's'}`);
      } catch (err) { toast('Could not build the page: ' + err.message, 5000); }
      a.disabled = false;
    }
  });
}
function bufToDataURL(buf, type) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(new Blob([buf], { type })); });
}
async function buildSharePage(o) {
  const list = shareSelection(o);
  const total = list.reduce((n, e) => n + (e.photos || []).length, 0);
  let done = 0;
  const shrink = async (rec, max) => {
    try { const { im, u } = await loadImg(new Blob([rec.data], { type: rec.type })); try { return bufToDataURL((await scaleTo(im, max, 0.8)).buf, 'image/jpeg'); } finally { URL.revokeObjectURL(u); } }
    catch (_) { return bufToDataURL(rec.data, rec.type); }
  };
  const articles = [];
  for (const e of list) {
    const d = new Date(e.created), meta = e.photoMeta || {};
    let body = '';
    for (const b of toBlocks(e)) {
      if (b.t === 'text') { if (b.v.trim()) body += md(b.v); continue; }
      const rec = await DB.get('photos', b.id); if (!rec) continue;
      toast(`Preparing photo ${++done} of ${total}…`, 60000);
      const m = meta[b.id];
      body += `<figure id="p-${b.id}"><img src="${await shrink(rec, o.px)}" alt="">${o.places && m && m.lat != null && m.name ? `<figcaption>${esc(m.name)}</figcaption>` : ''}</figure>`;
    }
    const place = o.places && e.location && e.location.name ? ` · ${esc(e.location.name)}` : '';
    articles.push(`<article id="e-${e.id}"><h2>${esc(fmtLong(d))}</h2><p class="when">${esc(fmtTime(d))}${place}</p>${body}</article>`);
  }
  const pts = o.map ? mapPoints(list) : [];
  const mapData = [];
  for (const p of pts) {
    let th = '';
    if (p.thumbId) { const rec = await DB.get('photos', p.thumbId); if (rec) th = rec.thumb ? await bufToDataURL(rec.thumb, 'image/jpeg') : await shrink(rec, 360); }
    mapData.push({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), c: p.caption, n: o.places ? p.name : '', d: fmtShort(new Date(p.t)), a: p.anchor, th });
  }
  const sk = o.places ? pts : pts.map((p) => ({ ...p, name: '' }));
  const first = new Date(list[0].created), last = new Date(list[list.length - 1].created);
  const range = dayKey(first) === dayKey(last) ? fmtLong(first) : `${fmtShort(first)} to ${fmtShort(last)}`;
  const miles = routeMiles(pts);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title || 'Trip')}</title>
<style>
:root{--bg:#f7f4ee;--surface:#fff;--text:#1d1f23;--muted:#6b6f78;--line:#e2ddd3;--accent:#1f4468;--gold:#c8923c}
@media (prefers-color-scheme:dark){:root{--bg:#16181c;--surface:#1f2227;--text:#eceae6;--muted:#9a9ea6;--line:#33373e;--accent:#8fb6de;--gold:#d9a553}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:18px/1.6 "New York","Iowan Old Style",Georgia,serif}
.wrap{max-width:720px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:34px;line-height:1.15;margin:0 0 6px}.sub{color:var(--muted);font:15px -apple-system,Helvetica,Arial,sans-serif;margin:0 0 20px}
.mapbox{height:60vh;min-height:300px;border-radius:14px;overflow:hidden;background:var(--surface);border:1px solid var(--line);position:relative}
.sketch{height:100%;display:flex;align-items:center;justify-content:center;background-image:radial-gradient(var(--line) 1px,transparent 1px);background-size:18px 18px}
.sk{width:100%;height:100%}.sk-route{fill:none;stroke:var(--gold);stroke-width:3;stroke-dasharray:7 6;stroke-linecap:round;stroke-linejoin:round}
.sk-pt.entry{fill:var(--accent);stroke:var(--surface);stroke-width:2}.sk-pt.photo{fill:var(--gold);stroke:var(--surface);stroke-width:2}.sk-start{fill:none;stroke:var(--accent);stroke-width:2}
.sk-lbl{font:13px -apple-system,Helvetica,Arial,sans-serif;fill:var(--text);paint-order:stroke;stroke:var(--surface);stroke-width:3px}
.mapnote{color:var(--muted);font:13px -apple-system,Helvetica,Arial,sans-serif;margin:8px 2px 28px}
article{border-top:1px solid var(--line);padding-top:22px;margin-top:26px}h2{font-size:22px;margin:0}
.when{color:var(--muted);font:14px -apple-system,Helvetica,Arial,sans-serif;margin:2px 0 14px}
article h1{font-size:24px;margin:14px 0 6px}article h3{font-size:19px}
figure{margin:14px 0 18px}figure img{width:100%;border-radius:12px;display:block}
figcaption{color:var(--muted);font:13px -apple-system,Helvetica,Arial,sans-serif;margin-top:6px}
blockquote{margin:0 0 12px;padding-left:12px;border-left:3px solid var(--gold);color:var(--muted)}a{color:var(--accent)}
footer{color:var(--muted);font:13px -apple-system,Helvetica,Arial,sans-serif;margin-top:40px;text-align:center}
.mk{cursor:pointer}.mk-ph{width:46px;height:46px;border-radius:50%;border:3px solid #fff;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.35);background:#ddd}
.mk-ph img{width:100%;height:100%;object-fit:cover;display:block}.mk-en{width:18px;height:18px;border-radius:50%;background:#1f4468;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.pp{font:14px -apple-system,Helvetica,Arial,sans-serif;color:#1d1f23}.pp img{width:100%;border-radius:8px;display:block;margin-bottom:6px}.pp b{display:block}.pp small{color:#6b6f78;display:block;margin:2px 0 6px}.pp a{color:#1f4468;font-weight:600}
</style></head><body><div class="wrap">
<h1>${esc(o.title || 'Trip')}</h1>
<p class="sub">${esc(range)} · ${list.length} entr${list.length === 1 ? 'y' : 'ies'}${total ? `, ${total} photo${total === 1 ? '' : 's'}` : ''}</p>
${pts.length ? `<div class="mapbox" id="map"><div class="sketch">${sketchSVG(sk)}</div></div>
<p class="mapnote">${pts.length > 1 ? `About ${Math.round(miles).toLocaleString()} miles of route. ` : ''}<span id="mapmsg">Opened in a web browser with a connection, this becomes a zoomable map; tap a photo on it to jump to that part of the trip.</span></p>` : ''}
${articles.join('\n')}
<footer>Made with Daybook</footer></div>
${pts.length ? `<script>
(function(){
  var P=${JSON.stringify(mapData).replace(/</g, '\\u003c')};
  var box=document.getElementById('map'), msg=document.getElementById('mapmsg');
  function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function build(ml){
    box.innerHTML='';
    var map=new ml.Map({container:box,style:${JSON.stringify(ML.style)},attributionControl:{compact:true}});
    map.addControl(new ml.NavigationControl({showCompass:false}),'top-right');
    var b=new ml.LngLatBounds(); P.forEach(function(p){b.extend([p.lon,p.lat]);});
    map.fitBounds(b,{padding:56,maxZoom:14,duration:0});
    map.on('load',function(){ if(P.length<2) return;
      map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:P.map(function(p){return [p.lon,p.lat];})}}});
      map.addLayer({id:'route',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#c8923c','line-width':3.5,'line-dasharray':[2,1.6]}}); });
    P.forEach(function(p){
      var el=document.createElement('div'); el.className='mk '+(p.th?'mk-ph':'mk-en');
      if(p.th){var im=document.createElement('img'); im.src=p.th; im.alt=''; el.appendChild(im);}
      var html='<div class="pp">'+(p.th?'<img src="'+p.th+'" alt="">':'')+'<b>'+esc(p.c)+'</b><small>'+esc(p.d)+(p.n?' · '+esc(p.n):'')+'</small><a href="#'+p.a+'">Read this part</a></div>';
      new ml.Marker({element:el}).setLngLat([p.lon,p.lat]).setPopup(new ml.Popup({offset:24,maxWidth:'240px'}).setHTML(html)).addTo(map);
    });
    msg.textContent='Tap a marker to see the photo and jump to that part of the trip. Map data from OpenFreeMap and OpenStreetMap.';
  }
  if(navigator.onLine===false) return;
  var l=document.createElement('link'); l.rel='stylesheet'; l.href=${JSON.stringify(ML.css)}; l.integrity=${JSON.stringify(ML.cssSri)}; l.crossOrigin='anonymous';
  var s=document.createElement('script'); s.src=${JSON.stringify(ML.js)}; s.integrity=${JSON.stringify(ML.jsSri)}; s.crossOrigin='anonymous';
  s.onload=function(){ try{ build(window.maplibregl); }catch(e){} };
  document.head.appendChild(l); document.head.appendChild(s);
})();
</script>` : ''}
</body></html>`;
  return { blob: new Blob([html], { type: 'text/html' }), entries: list.length, photos: total };
}

/* ---------- backup / export / import ---------- */
const changedAt = (e) => new Date(e.modified || e.created).getTime();
// an entry goes in the next sync file if it changed since the last one was sent, unless the change arrived in a sync file
const toSend = (e, since) => changedAt(e) > since && (!since || e.rcv !== e.modified);
async function buildBackup(sync) { // sync: { since } builds a sync file of changes, deletions included
  const zip = new JSZip(); const photosDir = zip.folder('photos');
  const recs = new Map((await DB.all('photos')).map((p) => [p.id, p]));
  const byJ = new Map(); let nPhotos = 0;
  const since = sync && sync.since ? new Date(sync.since).getTime() : 0;
  const pick = sync ? (x) => toSend(x, since) : (x) => !x.deleted;
  for (const e of S.entries.filter(pick).sort((a, b) => new Date(a.created) - new Date(b.created))) {
    const photos = [];
    (e.photos || []).forEach((pid, i) => {
      const p = recs.get(pid); if (!p) return;
      const bytes = new Uint8Array(p.data); const h = p.md5 || md5(bytes);
      const ext = (p.type.split('/')[1] || 'jpeg').replace('jpg', 'jpeg');
      photosDir.file(`${h}.${ext}`, bytes, { compression: 'STORE' }); nPhotos++;
      const pm = (e.photoMeta || {})[pid] || {};
      const po = { identifier: pid, md5: h, type: ext, width: p.w, height: p.h, orderInEntry: i };
      if (pm.taken) po.date = isoZ(pm.taken);
      if (pm.lat != null) po.location = { latitude: pm.lat, longitude: pm.lon, placeName: pm.name || '' };
      photos.push(po);
    });
    let text = e.text;
    const placed = new Set([...String(e.text).matchAll(MOMENT_RE)].map((m) => m[1]));
    const loose = photos.filter((p) => !placed.has(p.identifier));
    if (loose.length) text += (text ? '\n\n' : '') + loose.map((p) => `![](dayone-moment://${p.identifier})`).join('\n\n');
    const o = { uuid: e.id, creationDate: isoZ(e.created), modifiedDate: isoZ(e.modified || e.created), timeZone: e.tz || TZ,
      text, tags: e.tags || [], starred: !!e.starred, daybook: { journal: e.journal, mood: e.mood || null } };
    if (sync) Object.assign(o.daybook, { modified: e.modified || e.created, deleted: e.deleted || null, photoMeta: e.photoMeta || {} });
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
  let removed = 0;
  if (sync) {
    const tombs = (await DB.meta('tombstones', [])).filter((t) => new Date(t.at).getTime() > since);
    removed = tombs.length;
    zip.file('daybook-sync.json', JSON.stringify({ app: 'Daybook ' + APP_VERSION, from: DEVICE, sent: new Date().toISOString(),
      since: sync.since || null, tombstones: tombs }), { compression: 'DEFLATE' });
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return { blob, entries: [...byJ.values()].reduce((n, a) => n + a.length, 0), photos: nPhotos, removed };
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
    out += e.text.replace(MOMENT_RE, '*(photo)*').trim() + '\n';
  }
  return new Blob([out], { type: 'text/markdown' });
}

function offerFile(blob, name, detail, onSaved, kind) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const url = URL.createObjectURL(blob);
  const el = sheet(`<header><button class="txtbtn l" data-a="x">Close</button><div class="ttl">Ready to save</div><span style="min-width:64px"></span></header>
    <div class="scroll"><div class="card" style="padding:16px">
      <p style="margin:0 0 4px;font-weight:600">${esc(name)}</p><p class="note" style="margin:0 0 14px">${esc(detail)} · ${fmtBytes(blob.size)}</p>
      ${canShare ? `<button class="btn" style="width:100%" data-a="share">${ic('share')} ${kind === 'sync' ? 'AirDrop or share…' : IS_MAC ? 'Share…' : 'Save to Files or share…'}</button>` : ''}
      <a class="btn ghost" style="display:block;text-align:center;text-decoration:none;margin-top:10px" href="${url}" download="${esc(name)}" data-a="dl">Download</a>
      ${kind === 'sync' ? `<p class="note" style="margin-top:14px">Send this file to your other device: AirDrop it, or save it to iCloud Drive or Google Drive. There, open Daybook, go to Settings and choose <b>Open a sync file</b>.</p>` : `<p class="note" style="margin-top:14px">${IS_MAC ? 'On a Mac, Download saves to your Downloads folder; move the copy into iCloud Drive or Google Drive so it lives off this Mac.' : 'On iPhone, choose <b>Save to Files</b> and pick iCloud Drive or Google Drive so the copy lives off this phone.'}</p>`}
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
  const jsons = []; let zip = null; let journalsFile = null, syncInfo = null;
  if (/\.zip$/i.test(file.name) || /zip/.test(file.type)) {
    zip = await JSZip.loadAsync(file);
    for (const [path, f] of Object.entries(zip.files)) {
      if (f.dir || !/\.json$/i.test(path) || path.startsWith('__MACOSX') || /(^|\/)\._/.test(path)) continue;
      const data = JSON.parse(await f.async('string'));
      if (/daybook-journals\.json$/i.test(path)) { journalsFile = data; continue; }
      if (/daybook-sync\.json$/i.test(path)) { syncInfo = data; continue; }
      jsons.push({ name: path.split('/').pop().replace(/\.json$/i, ''), data });
    }
  } else {
    jsons.push({ name: file.name.replace(/\.json$/i, ''), data: JSON.parse(await file.text()) });
  }
  if (journalsFile && Array.isArray(journalsFile.journals)) {
    for (const j of journalsFile.journals) {
      const have = S.journals.find((x) => x.id === j.id);
      if (!have) S.journals.push({ id: j.id, name: j.name });
      else if (syncInfo && j.name) have.name = j.name; // a rename on the other device carries over
    }
  }
  // An entry changed here since the last sync, and also changed on the other device, is kept twice rather than lost.
  const syncedAt = syncInfo ? await DB.meta('syncedAt', null) : null;
  const r = { added: 0, updated: 0, skipped: 0, photos: 0, missing: 0, deleted: 0, removed: 0, conflicts: 0 };
  const ensureJournal = (name) => {
    let j = S.journals.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!j) { j = { id: uuid(), name }; S.journals.push(j); }
    return j.id;
  };
  const keepCopy = async (ex) => {
    const cp = JSON.parse(JSON.stringify(ex)); cp.id = uuid(); cp.photos = []; cp.photoMeta = {}; delete cp.rcv;
    for (const pid of ex.photos || []) {
      const rec = await DB.get('photos', pid); if (!rec) continue;
      const nid = uuid(); await DB.put('photos', { ...rec, id: nid }); cp.photos.push(nid);
      if (ex.photoMeta && ex.photoMeta[pid]) cp.photoMeta[nid] = ex.photoMeta[pid];
      cp.text = cp.text.split(`dayone-moment://${pid})`).join(`dayone-moment://${nid})`);
    }
    cp.tags = [...new Set([...(cp.tags || []), 'sync-conflict'])];
    await saveEntry(cp); r.conflicts++;
  };
  for (const { name, data } of jsons) {
    if (!data || !Array.isArray(data.entries)) continue;
    let fileJournal = data.daybook && data.daybook.journal;
    if (fileJournal && !S.journals.some((x) => x.id === fileJournal.id)) S.journals.push({ id: fileJournal.id, name: fileJournal.name });
    const defaultJ = fileJournal ? fileJournal.id : ensureJournal(name);
    for (const de of data.entries) {
      const id = de.uuid || uuid();
      const xb = de.daybook || {};
      const created = de.creationDate || new Date().toISOString();
      const modified = xb.modified || de.modifiedDate || created;
      let ex = S.entries.find((x) => x.id === id);
      const localNewer = ex && ex.modified && new Date(ex.modified) >= new Date(modified);
      // changed here since the last sync and also on the other device: keep both versions
      const clash = ex && syncedAt && !ex.deleted && !xb.deleted && new Date(ex.modified) > new Date(syncedAt);
      let asCopy = false;
      if (localNewer) { if (!clash) { r.skipped++; continue; } asCopy = true; }
      if (xb.deleted) { // deleted on the other device: move it to Recently Deleted here too
        if (!ex) { r.skipped++; continue; }
        ex.deleted = xb.deleted; ex.modified = modified; if (syncInfo) ex.rcv = modified; await DB.put('entries', ex); r.deleted++; continue;
      }
      const photoIds = [], idMap = new Map(), photoMeta = {};
      for (const p of de.photos || []) {
        const have = p.identifier ? await DB.get('photos', p.identifier) : null;
        const f = zip && p.md5 ? zip.file(new RegExp(`(^|/)photos/${p.md5}\\.[a-z0-9]+$`, 'i'))[0] : null;
        let rec;
        if (have && (!f || have.md5 === p.md5)) rec = have; // already here: no need to decode it again
        else if (f) {
          const bytes = await f.async('uint8array'); const ext = f.name.split('.').pop().toLowerCase();
          const type = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
          rec = { id: p.identifier || uuid(), type, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            w: p.width, h: p.height, md5: p.md5, created };
          try { const { im, u } = await loadImg(new Blob([bytes], { type })); rec.thumb = (await scaleTo(im, 360, 0.72)).buf; URL.revokeObjectURL(u); } catch (_) { /* thumbnail optional */ }
          await DB.put('photos', rec); r.photos++;
        } else { r.missing++; continue; }
        photoIds.push(rec.id); if (p.identifier) idMap.set(p.identifier, rec.id);
        const pl = p.location || {};
        if (xb.photoMeta && p.identifier && xb.photoMeta[p.identifier]) photoMeta[rec.id] = xb.photoMeta[p.identifier];
        else if (pl.latitude != null || p.date) photoMeta[rec.id] = { taken: p.date || null, ...(pl.latitude != null ? { lat: pl.latitude, lon: pl.longitude, name: pl.placeName || [pl.localityName, pl.administrativeArea].filter(Boolean).join(', '), src: 'photo' } : {}) };
      }
      const text = String(de.text || '')
        .replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1')
        .replace(/[ \t]*!\[[^\]]*\]\(dayone-moment:(\/*)([^)]*)\)[ \t]*/g, (m, sl, id) => (sl === '//' && idMap.has(id) ? `\n\n![](dayone-moment://${idMap.get(id)})\n\n` : ''))
        .replace(/\n{3,}/g, '\n\n').trim();
      const loc = de.location && de.location.latitude != null ? { lat: de.location.latitude, lon: de.location.longitude,
        name: de.location.placeName || [de.location.localityName, de.location.administrativeArea].filter(Boolean).join(', ') } : null;
      const w = de.weather ? { tempC: de.weather.temperatureCelsius ?? null, desc: de.weather.conditionsDescription || '' } : null;
      const differs = ex && (ex.text !== text || (ex.tags || []).join() !== (de.tags || []).join() || (ex.mood || null) !== (xb.mood || null));
      if (asCopy && !differs) { r.skipped++; continue; }
      if (clash && differs && !asCopy) await keepCopy(ex);
      const entry = { id, journal: xb.journal || defaultJ, created, modified, tz: de.timeZone || TZ, text,
        tags: Array.isArray(de.tags) ? de.tags : [], mood: xb.mood || null, starred: !!de.starred,
        location: loc, weather: w, photos: photoIds, photoMeta, deleted: null };
      if (syncInfo) entry.rcv = modified;
      if (asCopy) { // the version here is newer: file the other device's version beside it
        await keepCopy(entry); await deletePhotos(photoIds.filter((p) => !(ex.photos || []).includes(p))); r.skipped++; continue;
      }
      if (ex) { await deletePhotos((ex.photos || []).filter((p) => !photoIds.includes(p))); r.updated++; } else r.added++;
      await DB.put('entries', entry);
      const i = S.entries.findIndex((x) => x.id === id); if (i >= 0) S.entries[i] = entry; else S.entries.push(entry);
    }
  }
  if (syncInfo && Array.isArray(syncInfo.tombstones)) { // deleted for good on the other device
    for (const t of syncInfo.tombstones) {
      const ex = S.entries.find((x) => x.id === t.id);
      if (ex && changedAt(ex) <= new Date(t.at).getTime()) { await hardDelete(ex, false); r.removed++; }
    }
  }
  await DB.setMeta('journals', S.journals);
  if (syncInfo) { await DB.setMeta('syncedAt', new Date().toISOString()); await DB.setMeta('lastSyncIn', { from: syncInfo.from || 'another device', at: new Date().toISOString() }); }
  r.sync = !!syncInfo;
  return r;
}

async function sendSync(everything, after) {
  const since = everything ? null : await DB.meta('lastSyncSent', null);
  const started = new Date().toISOString();
  toast('Building sync file…', 20000);
  try {
    const { blob, entries, photos, removed } = await buildBackup({ since });
    toast('Sync file ready', 1200);
    const d = new Date();
    const name = `Daybook-sync-from-${DEVICE}-${dayKey(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
    offerFile(blob, name, `${entries} entr${entries === 1 ? 'y' : 'ies'}, ${photos} photo${photos === 1 ? '' : 's'}${removed ? `, ${removed} permanent deletion${removed === 1 ? '' : 's'}` : ''}${since ? ` changed since ${fmtShort(new Date(since))}, ${fmtTime(new Date(since))}` : ''}`, async () => {
      await DB.setMeta('lastSyncSent', started); await DB.setMeta('syncedAt', started); after && after();
    }, 'sync');
  } catch (err) { toast('Sync file failed: ' + err.message, 5000); }
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
    const lastSent = await DB.meta('lastSyncSent', null), lastIn = await DB.meta('lastSyncIn', null);
    const pending = S.entries.filter((e) => toSend(e, lastSent ? new Date(lastSent).getTime() : 0)).length
      + (lastSent ? (await DB.meta('tombstones', [])).filter((t) => t.at > lastSent).length : 0);
    el.innerHTML = `<header><span style="min-width:64px"></span><div class="ttl">Settings</div><button class="txtbtn r" data-a="x">Done</button></header>
    <div class="scroll">
      ${!standalone ? `<div class="banner">${ic('share')}<span>${IS_MAC ? `Install: in Safari, click the Share button and choose <b>Add to Dock</b> (in Chrome, the install icon at the right end of the address bar). Installed, Daybook opens in its own window and works offline.` : `Install: tap Share, then <b>Add to Home Screen</b>. Installed, Daybook works offline and your entries are protected from Safari's storage cleanup.`}</span></div>` : ''}
      <div class="stats"><div class="card"><b>${st.entries}</b><small>entries</small></div><div class="card"><b>${st.days}</b><small>days</small></div><div class="card"><b>${st.photos}</b><small>photos</small></div></div>
      <p class="note">${first ? `Journaling since ${esc(fmtShort(first))}. ` : ''}${st.words.toLocaleString()} words. Current streak ${st.streak} day${st.streak === 1 ? '' : 's'}.</p>

      <div class="group"><h3>Journals</h3><div class="card">
        ${S.journals.map((j) => { const n = all.filter((e) => e.journal === j.id).length; return `<button data-rename="${j.id}">${ic('book')}${esc(j.name)}<span class="sub">${n} · Rename</span></button>`; }).join('')}
        <button data-a="add-j">${ic('plus')}New journal</button></div></div>

      <div class="group"><h3>Sync with your other device</h3><div class="card">
        <button data-a="sync-send">${ic('share')}Send changes<span class="sub">${lastSent ? `${pending} since ${esc(fmtShort(new Date(lastSent)))}` : 'Everything (first time)'}</span></button>
        ${lastSent ? `<button data-a="sync-all">${ic('db')}Send everything</button>` : ''}
        <label style="cursor:pointer">${ic('in')}Open a sync file<span class="sub">${lastIn ? `Last from ${esc(lastIn.from)}, ${esc(fmtShort(new Date(lastIn.at)))}` : ''}</span><input type="file" accept=".zip,application/zip" hidden id="imp-sync"></label>
      </div><p class="note">To write on your Mac and your iPhone, keep Daybook on both and pass a sync file between them: <b>Send changes</b> on one, AirDrop the file, then <b>Open a sync file</b> on the other. Do it each way when you switch devices. New entries, edits, photos and deletions carry over. If the same entry was changed on both devices, both versions are kept and the extra copy is tagged #sync-conflict. The file goes only where you send it.</p></div>

      <div class="group"><h3>Backup and export</h3><div class="card">
        <button data-a="backup">${ic('db')}Back up now<span class="sub">${S.lastBackup ? 'Last ' + esc(fmtShort(new Date(S.lastBackup))) : 'Never'}</span></button>
        <button data-a="md">${ic('doc')}Export as Markdown</button>
        <label style="cursor:pointer">${ic('in')}Import backup or Day One export<input type="file" accept=".zip,.json,application/zip,application/json" hidden id="imp"></label>
      </div><p class="note">The backup is a .zip in Day One's export format (JSON plus a photos folder), so it restores here or imports into Day One.</p></div>

      <div class="group"><h3>Places and sharing</h3><div class="card">
        <button data-a="share">${ic('share')}Share a trip as a web page</button>
        <label>${ic('pin')}Place new camera photos where I am<input type="checkbox" id="autotag" class="sub" ${S.autoTag ? 'checked' : ''}></label>
      </div><p class="note">When a photo carries its location, Daybook uses it. iPhone removes the location from photos you add here, so Daybook places a photo taken in the last 30 minutes where ${HERE} is. Any photo can be placed by ${tap}ping the pin on the photo in the editor.</p></div>

      <div class="group"><h3>Privacy</h3><div class="card">
        <button data-a="lock">${ic('lock')}${S.lock ? 'Change passcode' : 'Set a passcode'}</button>
        ${S.lock ? `<label>${ic('clock')}Lock after<select id="lock-after" class="sub" style="border:0;background:transparent">
          ${[[0, 'Immediately'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes']].map(([v, t]) => `<option value="${v}" ${S.lockAfter === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <button data-a="unlock-off" style="color:var(--danger)">${ic('lock')}Turn off passcode</button>` : ''}
      </div><p class="note">The passcode is a privacy screen for someone using your unlocked ${DEVICE === 'iPhone' ? 'phone' : DEVICE}. It does not encrypt the data. If you forget it, the only way in is deleting the app, which erases everything not in a backup.</p></div>

      <div class="group"><h3>Recently deleted</h3><div class="card">
        ${trash.length ? trash.sort((a, b) => new Date(b.deleted) - new Date(a.deleted)).map((e) => `<div>${esc((titleSnip(e.text).title || 'Untitled').slice(0, 40))}<span class="sub"><button style="color:var(--accent);font-weight:600" data-restore="${e.id}">Restore</button> · <button style="color:var(--danger)" data-purge="${e.id}">Delete</button></span></div>`).join('')
          : `<div style="color:var(--muted)">Nothing here. Deleted entries stay 30 days.</div>`}
      </div></div>

      <div class="group"><h3>Storage</h3><div class="card">
        <div>${ic('db')}On ${HERE}<span class="sub">${est && est.usage != null ? fmtBytes(est.usage) + ' used' : 'Unknown'}</span></div>
        <div>${ic('lock')}Protected from cleanup<span class="sub">${persisted === true ? 'Yes' : IS_MAC ? 'Not confirmed' : standalone ? 'Home Screen app' : 'No: add to Home Screen'}</span></div>
      </div></div>
      <p class="note" style="text-align:center;margin:22px 0">Daybook ${APP_VERSION} · works offline · no account, no tracking. Your writing never leaves ${HERE} unless you share it or send a sync file. With a connection, the Map tab loads map tiles from OpenFreeMap, which sees the area being viewed.</p>
    </div>`;
  };
  await paint();
  el.addEventListener('change', async (ev) => {
    if (ev.target.id === 'autotag') { S.autoTag = ev.target.checked; await DB.setMeta('autoTag', S.autoTag); toast('Saved'); }
    if (ev.target.id === 'lock-after') { S.lockAfter = +ev.target.value; await DB.setMeta('lockAfter', S.lockAfter); toast('Saved'); }
    if (ev.target.id === 'imp' || ev.target.id === 'imp-sync') {
      const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
      toast('Importing…', 60000);
      try {
        const r = await importFile(f);
        toast(`${r.sync ? 'Synced' : 'Imported'}: ${r.added} new, ${r.updated} updated, ${r.skipped} unchanged${r.deleted ? `, ${r.deleted} moved to Recently Deleted` : ''}${r.removed ? `, ${r.removed} deleted` : ''}; ${r.photos} photos${r.missing ? `, ${r.missing} missing` : ''}${r.conflicts ? `. ${r.conflicts} changed on both devices: both versions kept, tagged #sync-conflict` : ''}`, r.conflicts ? 9000 : 6000);
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
      case 'sync-send': await sendSync(false, paint); break;
      case 'sync-all': await sendSync(true, paint); break;
      case 'share': openShare(); break;
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
      case 'share': openShare(); break;
    }
  });
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) S.hiddenAt = Date.now();
    else if (S.lock && Date.now() - S.hiddenAt >= S.lockAfter * 60000) lockNow();
  });
}

// keyboard, for use on a Mac: N new entry, / search, E edit the open entry, Esc close, Cmd+Enter or Cmd+S finish editing
function onKey(ev) {
  const lock = $('#lock');
  if (lock) {
    const k = /^[0-9]$/.test(ev.key) ? ev.key : ev.key === 'Backspace' ? 'b' : ev.key === 'Escape' ? 'c' : null;
    const b = k && $(`[data-k="${k}"]`, lock); if (b) { ev.preventDefault(); b.click(); }
    return;
  }
  const viewer = $('#viewer'); if (viewer && ev.key === 'Escape') { viewer.remove(); return; }
  const sheets = $$('.sheet'), top = sheets[sheets.length - 1];
  const mod = ev.metaKey || ev.ctrlKey;
  if (top && top._done && mod && (ev.key === 'Enter' || ev.key.toLowerCase() === 's')) { ev.preventDefault(); top._done(); return; }
  if (ev.key === 'Escape' && top) {
    const pop = $('#ed-pop', top);
    if (pop && pop.innerHTML) { pop.innerHTML = ''; pop.dataset.open = ''; return; }
    ev.preventDefault();
    if (top._done) return top._done();
    const b = $('header [data-a=back], header [data-a=x]', top); if (b) b.click();
    return;
  }
  const typing = ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable]');
  if (typing || mod || ev.altKey) return;
  if (top && top.dataset.reader && ev.key.toLowerCase() === 'e') { ev.preventDefault(); const b = $('[data-a=edit]', top); if (b) b.click(); return; }
  if (top) return;
  if (ev.key.toLowerCase() === 'n') { ev.preventDefault(); $('#btn-new').click(); }
  if (ev.key === '/') { ev.preventDefault(); $('nav.tabs [data-view=search]').click(); setTimeout(() => { const i = $('#main input[type=search]'); if (i) i.focus(); }, 50); }
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // updateViaCache 'none': always ask GitHub for sw.js itself, never a copy the phone kept
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    if (navigator.onLine) reg.update().catch(() => {});
    const watch = (w) => w && w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) { S.updateReady = w; render(); }
    });
    if (reg.waiting && navigator.serviceWorker.controller) { S.updateReady = reg.waiting; render(); }
    reg.addEventListener('updatefound', () => watch(reg.installing));
    // an installed app is usually resumed, not relaunched, so also check for a new version each time it comes back to the screen
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !navigator.onLine || Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now(); reg.update().catch(() => {});
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.updateReady && !reloaded) { reloaded = true; location.reload(); } });
}

function fitToKeyboard() {
  const vv = window.visualViewport; if (!vv) return;
  const root = document.documentElement.style;
  const apply = () => {
    root.setProperty('--vvh', vv.height + 'px');
    root.setProperty('--vvt', vv.offsetTop + 'px');
    // keyboard open: the home-indicator padding is not needed above the keyboard
    root.setProperty('--kb-sb', window.innerHeight - vv.height > 120 ? '0px' : 'env(safe-area-inset-bottom, 0px)');
  };
  vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); apply();
}

(async function init() {
  try {
    await DB.open(); await loadAll(); await purgeTrash();
    wire(); fitToKeyboard(); render(); registerSW();
    if (S.lock) lockNow();
  } catch (err) {
    document.body.innerHTML = `<div class="empty"><h2>Daybook could not open its storage</h2><p>${esc(err.message)}</p><p>If this is a Private Browsing tab, open Daybook in a normal tab or from the Home Screen.</p></div>`;
  }
})();
