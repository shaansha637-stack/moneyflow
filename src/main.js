import './style.css';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

/* ---------- constants & state ---------- */
const KEY = 'moneyflow.v1';
const CATS = ['Food', 'Shopping', 'Transport', 'Bills', 'Entertainment', 'Health', 'Salary', 'Transfer', 'Other'];
const COL = { Food: '#E8A33D', Shopping: '#7A6CF0', Transport: '#3AA0E8', Bills: '#E5604F', Entertainment: '#D65FA8', Health: '#35B58A', Salary: '#2E9E6B', Transfer: '#7E8A99', Other: '#A99B86' };
const ATYPES = ['Cash', 'Bank', 'Credit Card', 'Savings', 'Wallet'];
const CUR = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'CHF'];
const RANGES = [['all', 'All'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']];
const TABS = [
  ['home', 'Home', 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  ['tx', 'Transactions', 'M4 8h15l-3-3M20 16H5l3 3'],
  ['analytics', 'Analytics', 'M4 20v-9M10 20V4M16 20v-6M21 20H3'],
  ['accounts', 'Accounts', 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12M16 14h2'],
  ['settings', 'Settings', 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1']
];
let db = { accounts: [], tx: [], settings: { lock: false, currency: 'USD', theme: 'auto' } };
const ui = { tab: 'home', q: '', range: 'all', from: '', to: '', type: 'all', acct: 'all', sort: 'date-desc', limit: 100, month: '' };

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const r2 = (n) => Math.round(n * 100) / 100;
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => iso(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: db.settings.currency }).format(n);
const fdate = (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const rel = (s) => (s === today() ? 'Today' : s === daysAgo(1) ? 'Yesterday' : fdate(s));
const sum = (a, t) => r2(a.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0));
const bal = (a) => r2(a.opening + db.tx.filter((x) => x.acct === a.id).reduce((s, x) => s + (x.type === 'credit' ? x.amount : -x.amount), 0));
const acctName = (id) => db.accounts.find((a) => a.id === id)?.name || 'Deleted account';
const catTotals = (a) => {
  const m = {};
  a.filter((x) => x.type === 'debit').forEach((x) => { m[x.cat] = (m[x.cat] || 0) + x.amount; });
  return Object.entries(m).map(([label, value]) => ({ label, value: r2(value) })).sort((p, q) => q.value - p.value);
};
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

/* ---------- data layer (swap these two for cloud sync later) ---------- */
async function load() {
  const { value } = await Preferences.get({ key: KEY });
  if (value) {
    try { const p = JSON.parse(value); db = { ...db, ...p, settings: { ...db.settings, ...(p.settings || {}) } }; } catch { /* keep defaults */ }
  }
  if (!db.accounts.length) {
    db.accounts = [{ id: uid(), name: 'Cash', type: 'Cash', opening: 0 }, { id: uid(), name: 'Bank', type: 'Bank', opening: 0 }];
    persist();
  }
}
let saveTimer;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => Preferences.set({ key: KEY, value: JSON.stringify(db) }), 120); }
const applyTheme = () => { document.documentElement.dataset.theme = db.settings.theme; };

/* ---------- charts ---------- */
function donut(data) {
  const tot = data.reduce((s, d) => s + d.value, 0); const R = 42, C = 2 * Math.PI * R; let off = 0;
  const arcs = data.map((d) => {
    const len = (d.value / tot) * C;
    const s = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${COL[d.label]}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += len; return s;
  }).join('');
  return `<svg viewBox="0 0 120 120" class="donut" role="img" aria-label="Spending by category">${arcs}</svg>`;
}
function catChart(c) {
  const tot = c.reduce((s, d) => s + d.value, 0);
  if (!tot) return '<p class="empty">No spending yet. Add a debit to see where your money goes.</p>';
  return `<div class="cc">${donut(c)}<ul class="lg">${c.slice(0, 5).map((d) => `<li><i style="background:${COL[d.label]}"></i>${d.label}<b>${Math.round((d.value / tot) * 100)}%</b></li>`).join('')}</ul></div>`;
}
function ivs(i, e) {
  const m = Math.max(i, e, 1);
  return `<div class="bl"><span>Income</span><b class="pos">${money(i)}</b></div><div class="bar"><span style="width:${(i / m) * 100}%;background:var(--pos)"></span></div>
  <div class="bl"><span>Expenses</span><b class="neg">${money(e)}</b></div><div class="bar"><span style="width:${(e / m) * 100}%;background:var(--neg)"></span></div>`;
}
function trend(endMonth) {
  const [y, mo] = endMonth.split('-').map(Number); const cols = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, mo - 1 - i, 1); const k = iso(d).slice(0, 7);
    const a = db.tx.filter((x) => x.date.startsWith(k));
    cols.push({ l: d.toLocaleDateString(undefined, { month: 'short' }), i: sum(a, 'credit'), e: sum(a, 'debit') });
  }
  const m = Math.max(1, ...cols.flatMap((c) => [c.i, c.e]));
  const bars = cols.map((c, n) => {
    const x = n * 50 + 7, hi = (c.i / m) * 90, he = (c.e / m) * 90;
    return `<rect x="${x}" y="${100 - hi}" width="16" height="${hi}" rx="4" fill="var(--pos)"/><rect x="${x + 19}" y="${100 - he}" width="16" height="${he}" rx="4" fill="var(--neg)"/><text x="${x + 18}" y="118" text-anchor="middle" font-size="11" fill="var(--mute)">${c.l}</text>`;
  }).join('');
  return `<svg viewBox="0 0 300 124" width="100%" role="img" aria-label="Six month trend">${bars}</svg>`;
}

/* ---------- filtering ---------- */
function bounds() {
  const t = today();
  if (ui.range === 'today') return [t, t];
  if (ui.range === 'yesterday') return [daysAgo(1), daysAgo(1)];
  if (ui.range === 'week') { const d = new Date(); const back = (d.getDay() + 6) % 7; return [daysAgo(back), t]; }
  if (ui.range === 'month') return [t.slice(0, 7) + '-01', t.slice(0, 7) + '-31'];
  if (ui.range === 'custom') return [ui.from, ui.to];
  return ['', ''];
}
function filtered() {
  const q = ui.q.trim().toLowerCase(); const [from, to] = bounds();
  const a = db.tx.filter((x) => (ui.type === 'all' || x.type === ui.type) && (ui.acct === 'all' || x.acct === ui.acct) && (!from || x.date >= from) && (!to || x.date <= to) && (!q || `${x.name} ${x.cat} ${x.notes}`.toLowerCase().includes(q)));
  const [k, dir] = ui.sort.split('-');
  a.sort((p, r) => { const v = k === 'date' ? p.date.localeCompare(r.date) || p.created - r.created : p.amount - r.amount; return dir === 'asc' ? v : -v; });
  return a;
}

/* ---------- views ---------- */
const row = (x) => `<button class="row" data-act="edit" data-id="${x.id}"><span class="dot ${x.type}">${x.type === 'credit' ? '↓' : '↑'}</span><span class="rt"><b>${esc(x.name)}</b><small>${x.cat}, ${esc(acctName(x.acct))}, ${rel(x.date)}</small></span><span class="amt ${x.type}">${x.type === 'credit' ? '+' : '−'}${money(x.amount)}</span></button>`;

function home() {
  const m = today().slice(0, 7); const mt = db.tx.filter((x) => x.date.startsWith(m));
  const total = r2(db.accounts.reduce((s, a) => s + bal(a), 0));
  const recent = [...db.tx].sort((p, q) => q.date.localeCompare(p.date) || q.created - p.created).slice(0, 5);
  return `<h1>MoneyFlow</h1>
  <section class="hero"><small>Current balance</small><div class="num">${money(total)}</div>
  <div class="split"><div><small>Income</small><b>${money(sum(db.tx, 'credit'))}</b></div><div><small>Expenses</small><b>${money(sum(db.tx, 'debit'))}</b></div></div></section>
  <section class="card"><small>Spent this month</small><div class="num2">${money(sum(mt, 'debit'))}</div></section>
  <section class="card"><h3>Spending by category</h3>${catChart(catTotals(mt))}</section>
  <section class="card"><h3>Income vs expenses this month</h3>${ivs(sum(mt, 'credit'), sum(mt, 'debit'))}</section>
  <section class="card"><div class="hd"><h3>Recent</h3><button class="link" data-act="tab" data-id="tx">See all</button></div>${recent.length ? recent.map(row).join('') : '<p class="empty">No transactions yet. Tap + to add your first one.</p>'}</section>`;
}
function listHTML() {
  const a = filtered();
  if (!a.length) return '<p class="empty">No transactions match. Try a different search or filter.</p>';
  const shown = a.slice(0, ui.limit);
  return `<section class="card">${shown.map(row).join('')}${a.length > ui.limit ? '<button class="ghost" style="width:100%" data-act="more">Show more</button>' : ''}</section>`;
}
function txView() {
  return `<h1>Transactions</h1>
  <div class="search"><input id="q" type="search" placeholder="Search" value="${esc(ui.q)}"><button class="ghost" data-act="filters">Filter</button></div>
  <div class="chips">${RANGES.map(([k, l]) => `<button class="chip ${ui.range === k ? 'on' : ''}" data-act="range" data-id="${k}">${l}</button>`).join('')}</div>
  <div id="list">${listHTML()}</div>`;
}
function analytics() {
  const m = ui.month; const a = db.tx.filter((x) => x.date.startsWith(m));
  const inc = sum(a, 'credit'), exp = sum(a, 'debit'), net = r2(inc - exp); const cats = catTotals(a);
  const big = a.filter((x) => x.type === 'debit').sort((p, q) => q.amount - p.amount).slice(0, 5);
  const label = new Date(m + '-01T00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `<h1>Analytics</h1>
  <div class="mn"><button data-act="mprev" aria-label="Previous month">‹</button><b>${label}</b><button data-act="mnext" aria-label="Next month">›</button></div>
  <section class="hero"><small>Net balance</small><div class="num">${net < 0 ? '−' : ''}${money(Math.abs(net))}</div>
  <div class="split"><div><small>Income</small><b>${money(inc)}</b></div><div><small>Expenses</small><b>${money(exp)}</b></div></div></section>
  <section class="card"><h3>Credit vs debit</h3>${ivs(inc, exp)}</section>
  <section class="card"><h3>Spending by category</h3>${cats.length ? cats.map((d) => `<div class="bl"><span>${d.label}</span><b>${money(d.value)}</b></div><div class="bar"><span style="width:${(d.value / cats[0].value) * 100}%;background:${COL[d.label]}"></span></div>`).join('') : '<p class="empty">No spending in this month.</p>'}</section>
  <section class="card"><h3>Six month trend</h3>${trend(m)}<small>Green is income, red is expenses.</small></section>
  <section class="card"><h3>Largest expenses</h3>${big.length ? big.map(row).join('') : '<p class="empty">No expenses in this month.</p>'}</section>`;
}
function accounts() {
  const total = r2(db.accounts.reduce((s, a) => s + bal(a), 0));
  return `<h1>Accounts</h1><section class="hero"><small>Total across accounts</small><div class="num">${money(total)}</div></section>
  ${db.accounts.map((a) => `<section class="card"><div class="hd"><small>${esc(a.type)}</small><button class="link" style="margin:0" data-act="acctedit" data-id="${a.id}">Edit</button></div><button class="acct" data-act="acctopen" data-id="${a.id}"><b>${esc(a.name)}</b><div class="num2 ${bal(a) < 0 ? 'neg' : ''}">${money(bal(a))}</div><small>${db.tx.filter((x) => x.acct === a.id).length} transactions</small></button></section>`).join('')}
  <button class="primary" data-act="acctadd">Add account</button>`;
}
function settings() {
  const s = db.settings;
  return `<h1>Settings</h1><section class="card">
  <div class="set"><span>App lock<br><small>Face ID, Touch ID or passcode</small></span><input type="checkbox" data-set="lock" ${s.lock ? 'checked' : ''}></div>
  <div class="set"><span>Currency</span><select data-set="currency">${CUR.map((c) => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
  <div class="set"><span>Appearance</span><select data-set="theme">${['auto', 'light', 'dark'].map((c) => `<option value="${c}" ${c === s.theme ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></div></section>
  <section class="card"><h3>Your data</h3><p class="empty">Everything stays on this device. Nothing is sent to a server.</p>
  <button class="primary" data-act="export">Export CSV</button><button class="ghost danger" style="width:100%" data-act="erase">Erase all data</button></section>`;
}
const views = { home, tx: txView, analytics, accounts, settings };

function render(animate) {
  const v = $('#view'); v.innerHTML = views[ui.tab]();
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.id === ui.tab));
  $('#fab').classList.toggle('hide', !['home', 'tx'].includes(ui.tab));
  if (animate) { window.scrollTo(0, 0); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); }
}

/* ---------- sheets ---------- */
function closeSheet() { $('.scrim')?.remove(); }
function sheet(html) {
  closeSheet();
  const s = document.createElement('div'); s.className = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  s.addEventListener('click', (e) => { if (e.target === s) closeSheet(); });
  document.body.appendChild(s); requestAnimationFrame(() => s.classList.add('on'));
}
const opts = (list, sel) => list.map((o) => `<option ${o === sel ? 'selected' : ''}>${o}</option>`).join('');
function txSheet(id) {
  const x = id ? db.tx.find((t) => t.id === id) : { type: 'debit', amount: '', name: '', date: today(), cat: 'Food', acct: ui.acct !== 'all' ? ui.acct : db.accounts[0].id, notes: '' };
  sheet(`<h2>${id ? 'Edit' : 'Add'} transaction</h2><form id="f" data-id="${id || ''}">
  <div class="seg"><label><input type="radio" name="type" value="debit" ${x.type === 'debit' ? 'checked' : ''}><span>Debit</span></label><label><input type="radio" name="type" value="credit" ${x.type === 'credit' ? 'checked' : ''}><span>Credit</span></label></div>
  <input class="big" name="amount" inputmode="decimal" placeholder="0.00" value="${x.amount}" required>
  <input name="name" placeholder="Merchant or person" value="${esc(x.name)}" required>
  <div class="two"><input type="date" name="date" value="${x.date}" required><select name="cat">${opts(CATS, x.cat)}</select></div>
  <select name="acct">${db.accounts.map((a) => `<option value="${a.id}" ${a.id === x.acct ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
  <textarea name="notes" placeholder="Notes">${esc(x.notes)}</textarea>
  <button class="primary">Save</button>
  ${id ? `<div class="two"><button type="button" class="ghost" data-act="dup" data-id="${id}">Duplicate</button><button type="button" class="ghost danger" data-act="del" data-id="${id}">Delete</button></div>` : ''}</form>`);
}
function filterSheet() {
  sheet(`<h2>Filter and sort</h2><form id="ff">
  <select name="type"><option value="all">All types</option><option value="credit" ${ui.type === 'credit' ? 'selected' : ''}>Credits</option><option value="debit" ${ui.type === 'debit' ? 'selected' : ''}>Debits</option></select>
  <select name="acct"><option value="all">All accounts</option>${db.accounts.map((a) => `<option value="${a.id}" ${a.id === ui.acct ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
  <select name="sort">${[['date-desc', 'Newest first'], ['date-asc', 'Oldest first'], ['amount-desc', 'Largest amount'], ['amount-asc', 'Smallest amount']].map(([v, l]) => `<option value="${v}" ${v === ui.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <small>Custom date range</small><div class="two"><input type="date" name="from" value="${ui.from}"><input type="date" name="to" value="${ui.to}"></div>
  <button class="primary">Apply</button><button type="button" class="ghost" style="width:100%" data-act="resetf">Reset</button></form>`);
}
function acctSheet(id) {
  const a = id ? db.accounts.find((x) => x.id === id) : { name: '', type: 'Bank', opening: 0 };
  sheet(`<h2>${id ? 'Edit' : 'New'} account</h2><form id="af" data-id="${id || ''}">
  <input name="name" placeholder="Account name" value="${esc(a.name)}" required><select name="type">${opts(ATYPES, a.type)}</select>
  <small>Starting balance</small><input name="opening" inputmode="decimal" value="${a.opening}">
  <button class="primary">Save</button>${id ? `<button type="button" class="ghost danger" style="width:100%" data-act="acctdel" data-id="${id}">Delete account</button>` : ''}</form>`);
}

/* ---------- export ---------- */
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
async function exportCsv() {
  const head = 'Date,Type,Amount,Name,Category,Account,Notes';
  const lines = [...db.tx].sort((p, q) => q.date.localeCompare(p.date)).map((x) => [x.date, x.type === 'credit' ? 'Credit' : 'Debit', x.amount.toFixed(2), cell(x.name), x.cat, cell(acctName(x.acct)), cell(x.notes)].join(','));
  const csv = [head, ...lines].join('\n'); const name = `moneyflow-${today()}.csv`;
  try {
    const f = await Filesystem.writeFile({ path: name, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'MoneyFlow export', url: f.uri });
  } catch (err) {
    if (String(err?.message || err).toLowerCase().includes('cancel')) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
  }
}

/* ---------- app lock ---------- */
async function unlock() {
  try { await BiometricAuth.authenticate({ reason: 'Unlock MoneyFlow', allowDeviceCredential: true }); $('#lock')?.remove(); } catch { /* remain locked */ }
}
function showLock() {
  if (!db.settings.lock || $('#lock')) return;
  document.body.insertAdjacentHTML('beforeend', '<div id="lock"><h1>MoneyFlow</h1><p>Locked</p><button class="primary" data-act="unlock">Unlock</button></div>');
  unlock();
}

/* ---------- events ---------- */
const actions = {
  tab: (id) => { ui.tab = id; render(true); },
  add: () => txSheet(),
  edit: (id) => txSheet(id),
  del: (id) => { if (confirm('Delete this transaction?')) { db.tx = db.tx.filter((x) => x.id !== id); persist(); closeSheet(); render(); } },
  dup: (id) => {
    const x = db.tx.find((t) => t.id === id); const c = { ...x, id: uid(), date: today(), created: Date.now() };
    db.tx.push(c); persist(); render(); txSheet(c.id); toast('Duplicated. Adjust it if needed.');
  },
  more: () => { ui.limit += 100; $('#list').innerHTML = listHTML(); },
  range: (id) => { ui.range = id; ui.limit = 100; if (id === 'custom') { filterSheet(); } render(); },
  filters: () => filterSheet(),
  resetf: () => { Object.assign(ui, { type: 'all', acct: 'all', sort: 'date-desc', from: '', to: '', range: 'all', q: '', limit: 100 }); closeSheet(); render(); },
  mprev: () => shiftMonth(-1),
  mnext: () => shiftMonth(1),
  acctadd: () => acctSheet(),
  acctedit: (id) => acctSheet(id),
  acctopen: (id) => { ui.acct = id; ui.range = 'all'; ui.q = ''; ui.type = 'all'; ui.tab = 'tx'; render(true); },
  acctdel: (id) => {
    if (db.accounts.length < 2) return toast('Keep at least one account.');
    const n = db.tx.filter((x) => x.acct === id).length;
    if (!confirm(n ? `Delete this account and its ${n} transactions?` : 'Delete this account?')) return;
    db.accounts = db.accounts.filter((a) => a.id !== id); db.tx = db.tx.filter((x) => x.acct !== id);
    if (ui.acct === id) ui.acct = 'all';
    persist(); closeSheet(); render();
  },
  export: exportCsv,
  unlock,
  erase: () => {
    if (!confirm('Erase all accounts and transactions from this device? This cannot be undone.')) return;
    db.tx = []; db.accounts = []; Preferences.remove({ key: KEY }).then(async () => { await load(); render(true); });
  }
};
function shiftMonth(n) { const [y, m] = ui.month.split('-').map(Number); ui.month = iso(new Date(y, m - 1 + n, 1)).slice(0, 7); render(); }

document.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) actions[b.dataset.act]?.(b.dataset.id); });
document.addEventListener('input', (e) => { if (e.target.id === 'q') { ui.q = e.target.value; ui.limit = 100; $('#list').innerHTML = listHTML(); } });
document.addEventListener('submit', (e) => {
  e.preventDefault(); const f = e.target; const d = Object.fromEntries(new FormData(f));
  if (f.id === 'f') {
    const amount = r2(parseFloat(String(d.amount).replace(',', '.')));
    if (!(amount > 0) || !Number.isFinite(amount)) return toast('Enter an amount greater than zero.');
    const rec = { type: d.type, amount, name: d.name.trim(), date: d.date, cat: d.cat, acct: d.acct, notes: d.notes.trim() };
    if (f.dataset.id) Object.assign(db.tx.find((x) => x.id === f.dataset.id), rec); else db.tx.push({ id: uid(), created: Date.now(), ...rec });
  } else if (f.id === 'ff') {
    Object.assign(ui, { type: d.type, acct: d.acct, sort: d.sort, from: d.from, to: d.to, limit: 100 });
    if (d.from || d.to) ui.range = 'custom'; else if (ui.range === 'custom') ui.range = 'all';
  } else if (f.id === 'af') {
    const opening = r2(parseFloat(String(d.opening).replace(',', '.')) || 0); const rec = { name: d.name.trim(), type: d.type, opening };
    if (f.dataset.id) Object.assign(db.accounts.find((a) => a.id === f.dataset.id), rec); else db.accounts.push({ id: uid(), ...rec });
  } else return;
  persist(); closeSheet(); render();
});
document.addEventListener('change', async (e) => {
  const k = e.target.dataset?.set; if (!k) return;
  if (k === 'lock') {
    if (e.target.checked) {
      try {
        const c = await BiometricAuth.checkBiometry();
        if (!c.isAvailable && !c.deviceIsSecure) throw new Error('none');
        await BiometricAuth.authenticate({ reason: 'Turn on app lock', allowDeviceCredential: true });
        db.settings.lock = true;
      } catch { db.settings.lock = false; toast('App lock needs Face ID, Touch ID or a device passcode.'); }
    } else db.settings.lock = false;
  } else db.settings[k] = e.target.value;
  persist(); applyTheme(); render();
});

/* ---------- boot ---------- */
(async function boot() {
  await load(); applyTheme();
  ui.month = today().slice(0, 7);
  $('#tabs').innerHTML = TABS.map(([id, l, p]) => `<button class="tab" data-act="tab" data-id="${id}"><svg viewBox="0 0 24 24"><path d="${p}"/></svg>${l}</button>`).join('');
  render(true); showLock();
  App.addListener('pause', showLock);
})();
