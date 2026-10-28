/* BankScope AI front end. Data is precomputed in Python (bankcore/, scripts/build_data.py)
   by GitHub Actions; the browser formats it and recalculates interactive stress scenarios. */
'use strict';

const $ = (id) => document.getElementById(id);
const DEMO_CERT = 999999;
const VIEWS = ['overview', 'stress', 'research', 'method'];
// Same educational thresholds as bankcore/analytics.py WATCH_THRESHOLDS.
const THRESHOLDS = {
  equity_assets_pct: ['below', 8], uninsured_domestic_pct: ['above', 40], cash_deposits_pct: ['below', 10],
  loans_deposits_pct: ['above', 95], noncurrent_loans_pct: ['above', 2],
};
const REGULATORS = { OCC: 'OCC', FED: 'Federal Reserve', FDIC: 'FDIC', OTS: 'OTS' };

const state = {
  manifest: { banks: [{ cert: DEMO_CERT, name: 'Northstar Regional Bank (FICTIONAL)', display_name: 'Northstar Regional Bank', mode: 'demo', status: 'fictional' }], warnings: [] },
  report: null, brief: null, aiText: '', view: 'overview', load: 0, cert: null,
  sort: { key: 'assets', dir: -1 }, filter: 'all', query: '', homeScroll: null,
};

/* ================= formatting ================= */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
const MINUS = '−';
/** FDIC dollar amounts are reported in USD thousands. */
function fmtMoney(thousands) {
  if (!isNum(thousands)) return 'Not reported';
  const d = Number(thousands) * 1000, sign = d < 0 ? MINUS : '', a = Math.abs(d);
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
function fmtPct(n, d = 2) {
  if (!isNum(n)) return 'Not reported';
  const v = Number(n);
  return `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(d)}%`;
}
const dash = (n, d = 2) => (isNum(n) ? fmtPct(n, d) : '—');
function fmtDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? (iso || 'Unknown') : d.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
function fmtQuarter(iso, long = false) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return long ? `Q${q} ${d.getUTCFullYear()}` : `Q${q} ${String(d.getUTCFullYear()).slice(2)}`;
}
function fmtBuildTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
}
const setText = (id, text) => { $(id).textContent = text; };
function displayName(b) {
  if (b?.display_name) return b.display_name;
  const small = new Set(['of', 'and', 'the', 'for']);
  return String(b?.name || 'Unknown institution').toLowerCase().split(/\s+/).map((w, i) =>
    (w === 'na' ? 'N.A.' : i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ').replace(/ N\.A\.$/, ', N.A.');
}
const place = (b) => [b.city, b.state].filter(Boolean).join(', ');
const crosses = (key, v) => {
  const t = THRESHOLDS[key];
  return t && isNum(v) ? (t[0] === 'below' ? Number(v) < t[1] : Number(v) > t[1]) : false;
};
function median(values) {
  const v = values.filter(isNum).map(Number).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/* ================= data ================= */
async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  try { return await r.json(); } catch { throw new Error(`${path} is not valid JSON`); }
}
const banks = () => state.manifest.banks;
const realBanks = () => banks().filter((b) => b.mode === 'live');
const activeBanks = () => realBanks().filter((b) => b.status !== 'failed');
const failedBanks = () => realBanks().filter((b) => b.status === 'failed');
const bankByCert = (cert) => banks().find((b) => Number(b.cert) === Number(cert));
const isDemo = () => state.report?.data_mode === 'demo';

/* ================= theme ================= */
function syncThemeButton() {
  const lt = document.documentElement.classList.contains('lt');
  $('theme-toggle').setAttribute('aria-label', lt ? 'Switch to dark theme' : 'Switch to light theme');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', lt ? '#eceff3' : '#080c13');
}
$('theme-toggle').addEventListener('click', () => {
  const lt = document.documentElement.classList.toggle('lt');
  try { localStorage.setItem('bankscope-theme', lt ? 'light' : 'dark'); } catch { /* storage unavailable */ }
  syncThemeButton();
  tiles.redraw();
});
syncThemeButton();

/* Cursor-following highlight on glass panels (the lineup's soft white glow). */
document.addEventListener('pointermove', (e) => {
  const g = e.target.closest?.('.glass');
  if (!g) return;
  const r = g.getBoundingClientRect();
  g.style.setProperty('--mx', `${e.clientX - r.left}px`);
  g.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

/* ================= hero tiles ================= */
const tiles = (() => {
  const canvas = $('hero-tiles');
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cells = [], w = 0, h = 0, raf = 0, visible = true, last = 0;
  const S = 14, GAP = 6;
  function size() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cells = [];
    for (let y = 0; y < h; y += S + GAP) for (let x = 0; x < w; x += S + GAP) {
      const r = Math.random();
      cells.push({ x, y, a: r < 0.06 ? 0.55 + Math.random() * 0.35 : r < 0.3 ? 0.12 + Math.random() * 0.12 : 0.04, t: 0 });
    }
  }
  function draw() {
    const css = getComputedStyle(document.documentElement);
    const lit = css.getPropertyValue('--acc').trim() || '#74a9dd';
    const base = css.getPropertyValue('--t3').trim() || '#7f8c9d';
    ctx.clearRect(0, 0, w, h);
    for (const c of cells) {
      ctx.globalAlpha = c.a * (c.a > 0.5 ? 0.6 : 0.5);
      ctx.fillStyle = c.a > 0.5 ? lit : base;
      ctx.fillRect(c.x, c.y, S, S);
    }
    ctx.globalAlpha = 1;
  }
  function step(t) {
    raf = requestAnimationFrame(step);
    if (!visible || document.hidden || t - last < 120) return;
    last = t;
    for (let i = 0; i < 6; i++) {
      const c = cells[(Math.random() * cells.length) | 0];
      if (!c) continue;
      const r = Math.random();
      c.a = r < 0.3 ? 0.55 + Math.random() * 0.35 : r < 0.6 ? 0.12 + Math.random() * 0.12 : 0.04;
    }
    draw();
  }
  function start() {
    size(); draw();
    if (!reduce) raf = requestAnimationFrame(step);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { size(); draw(); }, 200); });
  }
  return { start, redraw: () => draw() };
})();

/* ================= routing ================= */
function parseHash() {
  const raw = location.hash.slice(1);
  if (!raw.includes('=')) return { route: 'home', anchor: raw || null };
  const p = new URLSearchParams(raw);
  return { route: 'detail', bank: Number(p.get('bank')) || null, view: VIEWS.includes(p.get('view')) ? p.get('view') : 'overview' };
}
function setNav(which) {
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('on', a.dataset.nav === which);
}
function showRoute(route) {
  const toHome = route === 'home';
  if (!toHome && !$('home').hidden) state.homeScroll = scrollY;
  $('home').hidden = !toHome;
  $('detail').hidden = toHome;
}
async function route() {
  const r = parseHash();
  if (r.route === 'home') {
    const fromDetail = !$('detail').hidden;
    showRoute('home');
    document.title = 'BankScope AI · Bank risk research';
    setNav(r.anchor === 'institutions' ? 'institutions' : r.anchor === 'case-studies' ? 'cases' : 'dashboard');
    if (r.anchor && $(r.anchor)) $(r.anchor).scrollIntoView();
    else if (fromDetail && state.homeScroll !== null) scrollTo(0, state.homeScroll);
    else scrollTo(0, 0);
    return;
  }
  const first = activeBanks()[0];
  const cert = r.bank && bankByCert(r.bank) ? r.bank : state.cert || (first ? Number(first.cert) : DEMO_CERT);
  const wasHome = !$('detail').hidden ? false : true;
  showRoute('detail');
  setNav(r.view === 'method' ? 'method' : null);
  showView(r.view);
  if (wasHome) scrollTo(0, 0);
  if (Number(cert) !== Number(state.cert) || !state.report) await loadBank(cert);
  else writeHash();
}
addEventListener('hashchange', route);
for (const a of document.querySelectorAll('[data-home]')) a.addEventListener('click', (e) => {
  // Same-hash clicks do not fire hashchange; handle them directly.
  const target = (a.getAttribute('href') || '#').slice(1);
  if (location.hash.slice(1) === target) { e.preventDefault(); route(); }
});
const openBank = (cert, view = 'overview') => { location.hash = `bank=${Number(cert)}&view=${view}`; };

/* ================= home: snapshot ================= */
function latestQuarter() {
  const counts = {};
  for (const b of activeBanks()) counts[b.as_of] = (counts[b.as_of] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
function renderStats() {
  const act = activeBanks(), fail = failedBanks();
  const sum = (k) => act.reduce((t, b) => t + (isNum(b.summary?.[k]) ? Number(b.summary[k]) : 0), 0);
  const corner = act.filter((b) => crosses('uninsured_domestic_pct', b.summary?.uninsured_domestic_pct) && crosses('cash_deposits_pct', b.summary?.cash_deposits_pct)).length;
  const q = latestQuarter();
  const items = act.length ? [
    ['Institutions', String(realBanks().length), `${act.length} largest by assets, ${fail.length} failed`],
    ['Combined assets', fmtMoney(sum('assets')), `${act.length} operating banks`],
    ['Combined deposits', fmtMoney(sum('deposits')), q ? `Quarter ended ${fmtDate(q)}` : ''],
    ['Median equity / assets', dash(median(act.map((b) => b.summary?.equity_assets_pct))), 'Accounting capital'],
    ['Median uninsured share', dash(median(act.map((b) => b.summary?.uninsured_domestic_pct)), 1), 'Of domestic deposits'],
    ['Run-risk corner', `${corner} of ${act.length}`, `Uninsured > ${THRESHOLDS.uninsured_domestic_pct[1]}% and cash < ${THRESHOLDS.cash_deposits_pct[1]}%`],
  ] : [['Institutions', '0', 'No FDIC data in this build'], ['Demo bank', '1', 'Fictional data available']];
  $('stats').innerHTML = items.map(([l, v, n]) => `<div class="stat"><div class="stat-label">${esc(l)}</div><div class="stat-value">${esc(v)}</div><div class="stat-note">${esc(n)}</div></div>`).join('');
  const built = fmtBuildTime(state.manifest.generated_at_utc);
  setText('sys-note', act.length
    ? `FDIC quarterly data, ${q ? fmtQuarter(q, true) : 'latest quarter'}. Built ${built || 'recently'} by GitHub Actions.`
    : 'This build has no FDIC data. Only the fictional demo bank is available.');
}

/* ================= home: ticker ================= */
function renderTicker() {
  const act = [...activeBanks()].sort((a, b) => (a.asset_rank || 999) - (b.asset_rank || 999));
  const q = latestQuarter();
  const short = (b) => displayName(b).replace(/,? (N\.A\.|National Association)$/i, '');
  const items = [
    q ? `<span class="tk-asof">● As of ${esc(fmtQuarter(q, true))}</span>` : '',
    ...act.map((b) => `<span><span class="tk-name">${esc(short(b))}</span> ${esc(fmtMoney(b.summary?.assets))} <span class="tk-lbl">E/A</span> <span class="${crosses('equity_assets_pct', b.summary?.equity_assets_pct) ? 'tk-dn' : 'tk-up'}">${esc(dash(b.summary?.equity_assets_pct))}</span></span>`),
    ...failedBanks().map((b) => `<span><span class="tk-fail">Failed ${esc(fmtDate(b.failed_on, { month: 'short', year: 'numeric' }))}</span> <span class="tk-name">${esc(short(b))}</span> <span class="tk-lbl">Uninsured</span> <span class="tk-dn">${esc(dash(b.summary?.uninsured_domestic_pct, 1))}</span></span>`),
  ].filter(Boolean).join('');
  $('ticker-track').innerHTML = items + items; // duplicated for a seamless loop
  $('ticker').hidden = !act.length;
}

/* ================= home: run-risk map ================= */
function renderMap() {
  const pts = realBanks().filter((b) => isNum(b.summary?.uninsured_domestic_pct) && isNum(b.summary?.cash_deposits_pct));
  const box = $('map-chart');
  if (!pts.length) { box.innerHTML = '<p class="empty">No institutions with both uninsured deposit and cash data in this build.</p>'; return; }
  const W = Math.max(320, Math.round(box.clientWidth || 760)), H = W < 520 ? 320 : 420;
  const L = 50, R = 18, T = 14, B = 46, vw = W - L - R, vh = H - T - B;
  const ymaxRaw = Math.max(20, ...pts.map((b) => Number(b.summary.cash_deposits_pct)));
  const ymax = Math.min(100, Math.ceil(ymaxRaw / 10) * 10);
  const x = (v) => L + (Math.min(100, Math.max(0, v)) / 100) * vw;
  // Square-root scale: spreads the 0-15% range where most banks sit, keeps custody banks on the chart.
  const y = (v) => T + (1 - Math.sqrt(Math.min(ymax, Math.max(0, v)) / ymax)) * vh;
  const maxA = Math.max(...pts.map((b) => Number(b.summary.assets) || 0), 1);
  const rad = (b) => 3.5 + Math.sqrt((Number(b.summary.assets) || 0) / maxA) * (W < 520 ? 14 : 20);
  const [ux, cy] = [THRESHOLDS.uninsured_domestic_pct[1], THRESHOLDS.cash_deposits_pct[1]];
  let g = `<rect class="zone" x="${x(ux)}" y="${y(cy)}" width="${x(100) - x(ux)}" height="${y(0) - y(cy)}"/>`;
  g += `<text class="zone-label" x="${x(100) - 6}" y="${y(0) - 9}" text-anchor="end">UNINSURED > ${ux}% · CASH < ${cy}%</text>`;
  for (let v = 0; v <= 100; v += 20) g += `<line class="grid-line" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${T + vh}"/><text class="axis-text" x="${x(v)}" y="${T + vh + 18}" text-anchor="middle">${v}%</text>`;
  for (const v of [0, 2.5, 5, 10, 20, 30, 40, 50, 70, 100].filter((t) => t <= ymax)) g += `<line class="grid-line" x1="${L}" x2="${L + vw}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
  g += `<text class="axis-title" x="${L + vw / 2}" y="${H - 6}" text-anchor="middle">Uninsured share of domestic deposits</text>`;
  g += `<text class="axis-title" transform="translate(13 ${T + vh / 2}) rotate(-90)" text-anchor="middle">Cash / deposits (square-root scale)</text>`;
  const order = [...pts].sort((a, b) => (Number(b.summary.assets) || 0) - (Number(a.summary.assets) || 0));
  const labeled = new Set([...failedBanks().map((b) => b.cert), ...(W < 520 ? [] : order.filter((b) => b.status !== 'failed').slice(0, 3).map((b) => b.cert))]);
  const placed = [];
  const placeLabel = (txt, cx, cyy, r) => {
    const wpx = txt.length * 6.4 + 4, right = cx + r + 6 + wpx > L + vw;
    const x0 = right ? cx - r - 6 - wpx : cx + r + 6;
    for (const dy of [0, -15, 15, -30, 30, -45, 45]) {
      const box = { x0, x1: x0 + wpx, y0: cyy + dy - 9, y1: cyy + dy + 5 };
      if (box.y0 < T || box.y1 > T + vh) continue;
      if (!placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) { placed.push(box); return { x: right ? x0 + wpx : x0, y: cyy + dy + 4, anchor: right ? 'end' : 'start' }; }
    }
    return null;
  };
  const short = (b) => displayName(b).replace(/,? (N\.A\.|National Association)$/i, '');
  const labelSvg = [];
  g += order.map((b) => {
    const s = b.summary, failed = b.status === 'failed', cx = x(s.uninsured_domestic_pct), cyy = y(s.cash_deposits_pct), r = rad(b);
    const label = `${displayName(b)}: uninsured ${fmtPct(s.uninsured_domestic_pct, 1)}, cash to deposits ${fmtPct(s.cash_deposits_pct, 1)}${failed ? `, failed ${fmtDate(b.failed_on)}` : ''}`;
    const pos = labeled.has(b.cert) ? placeLabel(short(b), cx, cyy, r) : null;
    const text = pos ? `<text class="pt-label ${failed ? 'failed' : ''}" x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" text-anchor="${pos.anchor}">${esc(short(b))}</text>` : '';
    if (text) labelSvg.push(text);
    return `<a class="pt ${failed ? 'failed' : ''}" href="#bank=${Number(b.cert)}&amp;view=overview" data-cert="${Number(b.cert)}" aria-label="${esc(label)}"><circle cx="${cx.toFixed(1)}" cy="${cyy.toFixed(1)}" r="${r.toFixed(1)}"/></a>`;
  }).join('') + labelSvg.join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter chart of ${pts.length} banks: uninsured deposit share against cash to deposits">${g}</svg>`;

  const tip = $('map-tip'), panel = box.closest('.map-panel');
  const show = (el) => {
    const b = bankByCert(el.dataset.cert); if (!b) return;
    const s = b.summary;
    tip.innerHTML = `<strong>${esc(displayName(b))}</strong><dl><dt>${b.status === 'failed' ? `Failed ${esc(fmtDate(b.failed_on))}` : `#${b.asset_rank || '—'} by assets`}</dt><dd>${esc(fmtMoney(s.assets))}</dd><dt>Uninsured share</dt><dd>${esc(fmtPct(s.uninsured_domestic_pct, 1))}${Number(s.uninsured_domestic_pct) > 100 ? '*' : ''}</dd><dt>Cash / deposits</dt><dd>${esc(fmtPct(s.cash_deposits_pct, 1))}</dd><dt>Equity / assets</dt><dd>${esc(dash(s.equity_assets_pct))}</dd><dt>Reported</dt><dd>${esc(fmtDate(b.as_of))}</dd></dl>`;
    tip.hidden = false;
    const pr = panel.getBoundingClientRect(), cr = el.getBoundingClientRect();
    let left = cr.right - pr.left + 10, top = cr.top - pr.top - 10;
    if (left + 230 > pr.width) left = cr.left - pr.left - 240;
    tip.style.left = `${Math.max(8, left)}px`; tip.style.top = `${Math.max(8, top)}px`;
  };
  for (const el of box.querySelectorAll('.pt')) {
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('focus', () => show(el));
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
    el.addEventListener('blur', () => { tip.hidden = true; });
  }

  // Data-driven callout about SVB (or whichever failed bank sits furthest right).
  const worst = failedBanks().filter((b) => isNum(b.summary?.uninsured_domestic_pct)).sort((a, b) => b.summary.uninsured_domestic_pct - a.summary.uninsured_domestic_pct)[0];
  const inZone = activeBanks().filter((b) => crosses('uninsured_domestic_pct', b.summary?.uninsured_domestic_pct) && crosses('cash_deposits_pct', b.summary?.cash_deposits_pct)).length;
  $('map-callout').textContent = worst
    ? `${displayName(worst)}'s last report, for ${fmtDate(worst.as_of)}, showed ${fmtPct(worst.summary.uninsured_domestic_pct, 1)} of domestic deposits uninsured and cash equal to ${fmtPct(worst.summary.cash_deposits_pct, 1)} of deposits. It failed on ${fmtDate(worst.failed_on)}. ${inZone} of today's ${activeBanks().length} largest banks sit in the shaded corner.`
    : '';
}

/* ================= home: institutions table ================= */
const COLS = [
  { key: 'rank', label: '#', get: (b) => b.asset_rank ?? null },
  { key: 'name', label: 'Institution', get: (b) => displayName(b) },
  { key: 'assets', label: 'Total assets', get: (b) => b.summary?.assets, fmt: fmtMoney },
  { key: 'equity_assets_pct', label: 'Equity / assets', get: (b) => b.summary?.equity_assets_pct },
  { key: 'risk_based_capital_pct', label: 'Total RBC', get: (b) => b.summary?.risk_based_capital_pct },
  { key: 'uninsured_domestic_pct', label: 'Uninsured', get: (b) => b.summary?.uninsured_domestic_pct, d: 1 },
  { key: 'cash_deposits_pct', label: 'Cash / dep.', get: (b) => b.summary?.cash_deposits_pct, d: 1 },
  { key: 'loans_deposits_pct', label: 'Loans / dep.', get: (b) => b.summary?.loans_deposits_pct, d: 1 },
  { key: 'noncurrent_loans_pct', label: 'Noncurrent', get: (b) => b.summary?.noncurrent_loans_pct },
  { key: 'roa_pct', label: 'ROA', get: (b) => b.summary?.roa_pct },
  { key: 'watch_count', label: 'Checks', get: (b) => b.summary?.watch_count ?? null },
];
function renderTableHead() {
  $('inst-head').innerHTML = COLS.map((c) => {
    const on = state.sort.key === c.key;
    const aria = on ? ` aria-sort="${state.sort.dir > 0 ? 'ascending' : 'descending'}"` : '';
    return `<th scope="col"${aria}><button type="button" data-sort="${c.key}">${esc(c.label)}<span class="sort-ico" aria-hidden="true">${on ? (state.sort.dir > 0 ? '▲' : '▼') : ''}</span></button></th>`;
  }).join('');
  for (const btn of $('inst-head').querySelectorAll('button')) btn.addEventListener('click', () => {
    const k = btn.dataset.sort;
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'name' || k === 'rank' ? 1 : -1 };
    renderTable();
  });
}
function renderTable() {
  renderTableHead();
  const q = state.query.trim().toLowerCase();
  let list = realBanks().filter((b) => {
    if (state.filter === 'top' && !b.asset_rank) return false;
    if (state.filter === 'failed' && b.status !== 'failed') return false;
    if (state.filter === 'watch' && !((b.summary?.watch_count || 0) > 0)) return false;
    if (!q) return true;
    return [displayName(b), b.name, b.city, b.state, String(b.cert), b.holding_company].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  const col = COLS.find((c) => c.key === state.sort.key) || COLS[2];
  list.sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * state.sort.dir;
  });
  $('inst-body').innerHTML = list.length ? list.map((b) => {
    const s = b.summary || {}, failed = b.status === 'failed';
    const cells = COLS.slice(2).map((c) => {
      const v = c.get(b);
      if (c.key === 'assets') return `<td>${esc(fmtMoney(v))}</td>`;
      if (c.key === 'watch_count') {
        const n = s.checks || 0;
        return `<td><span class="checks-cell" aria-label="${v ?? 0} of ${n} checks on watch">${Array.from({ length: n }, (_, i) => `<i class="${i < (v || 0) ? 'on' : ''}"></i>`).join('')}</span></td>`;
      }
      const over = c.key === 'uninsured_domestic_pct' && isNum(v) && Number(v) > 100;
      return `<td class="${crosses(c.key, v) ? 'v-warn' : ''}"${over ? ' title="The FDIC estimate exceeds domestic deposits; shown as filed"' : ''}>${esc(dash(v, c.d ?? 2))}${over ? '*' : ''}</td>`;
    }).join('');
    const sub = failed ? `Failed ${fmtDate(b.failed_on)}, last report ${fmtDate(b.as_of)}`
      : b.status === 'inactive' ? `${place(b) ? `${place(b)} · ` : ''}Charter inactive since ${fmtDate(b.inactive_since)}`
      : [place(b), REGULATORS[b.regulator] || b.regulator].filter(Boolean).join(' · ');
    return `<tr tabindex="0" data-cert="${Number(b.cert)}"><td>${b.asset_rank ?? '—'}</td><td class="bank-cell"><strong>${esc(displayName(b))}${failed ? '<span class="badge badge-fail">Failed</span>' : ''}</strong><span>${esc(sub)}</span></td>${cells}</tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="${COLS.length}">No institutions match "${esc(state.query)}".</td></tr>`;
  for (const tr of $('inst-body').querySelectorAll('tr[data-cert]')) {
    tr.addEventListener('click', () => openBank(tr.dataset.cert));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBank(tr.dataset.cert); } });
  }
  const demo = bankByCert(DEMO_CERT);
  const missed = (state.manifest.warnings || []).length;
  $('inst-foot').innerHTML = `${missed ? `${missed} item(s) could not be downloaded in the last build and are not shown. ` : ''}Showing ${list.length} of ${realBanks().length}. Amber figures cross a screening threshold.${list.some((b) => Number(b.summary?.uninsured_domestic_pct) > 100) ? ' * The FDIC\'s uninsured-deposit estimate is larger than domestic deposits for this bank; it is shown as filed.' : ''} Values are each bank's latest filed quarter; failed banks show their last report.${demo ? ' A <a class="link" href="#bank=999999&amp;view=overview">fictional demo bank</a> is available for practice.' : ''}`;
}
$('inst-search').addEventListener('input', (e) => { state.query = e.target.value; renderTable(); });
for (const btn of $('inst-filter').querySelectorAll('button')) btn.addEventListener('click', () => {
  state.filter = btn.dataset.filter;
  for (const b of $('inst-filter').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
  renderTable();
});

/* ================= home: case studies ================= */
function renderCases() {
  const list = failedBanks().sort((a, b) => String(a.failed_on).localeCompare(String(b.failed_on)));
  $('case-studies').hidden = !list.length;
  $('cases').innerHTML = list.map((b) => {
    const s = b.summary || {};
    return `<article class="glass case" data-cert="${Number(b.cert)}">
      <div class="case-top"><div><p class="label">Failed ${esc(fmtDate(b.failed_on))}</p><h3>${esc(displayName(b))}</h3></div><span class="badge badge-fail">Case study</span></div>
      <p class="case-meta">${esc([place(b), `last report ${fmtDate(b.as_of)}`, fmtMoney(s.assets) + ' in assets'].filter(Boolean).join(' · '))}</p>
      <dl><div><dt>Uninsured</dt><dd>${esc(dash(s.uninsured_domestic_pct, 1))}</dd></div><div><dt>Cash / dep.</dt><dd>${esc(dash(s.cash_deposits_pct, 1))}</dd></div><div><dt>Equity / assets</dt><dd>${esc(dash(s.equity_assets_pct, 1))}</dd></div></dl>
      <a class="case-link" href="#bank=${Number(b.cert)}&amp;view=overview">Open the case study</a>
    </article>`;
  }).join('');
  for (const c of $('cases').querySelectorAll('.case')) c.addEventListener('click', (e) => { if (!e.target.closest('a')) openBank(c.dataset.cert); });
}

/* ================= detail: tabs ================= */
const tabs = () => [...document.querySelectorAll('[role="tab"]')];
function showView(view, { focus = false } = {}) {
  state.view = view;
  for (const t of tabs()) {
    const on = t.dataset.view === view;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  setNav(view === 'method' ? 'method' : null);
  if (view === 'overview' && state.report) renderChart();
  writeHash();
}
for (const t of tabs()) t.addEventListener('click', () => showView(t.dataset.view));
$('tablist').addEventListener('keydown', (e) => {
  const list = tabs(), i = list.findIndex((t) => t.dataset.view === state.view);
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  showView(list[(next + list.length) % list.length].dataset.view, { focus: true });
});
function writeHash() {
  if (!state.report || $('detail').hidden) return;
  history.replaceState(null, '', `#bank=${state.report.institution.cert}&view=${state.view}`);
}

/* ================= detail: overview ================= */
function quarterChange(key) {
  const h = state.report.history;
  if (h.length < 2) return null;
  const cur = h[h.length - 1][key], prev = h[h.length - 2][key];
  return isNum(cur) && isNum(prev) && Number(prev) !== 0 ? (Number(cur) / Number(prev) - 1) * 100 : null;
}
function deltaHTML(pct) {
  if (pct === null) return '<span class="reading-note">No prior quarter</span>';
  const cls = Math.abs(pct) < 0.05 ? 'flat' : pct > 0 ? 'up' : 'down';
  return `<span class="delta ${cls}">${pct > 0 ? '+' : pct < 0 ? MINUS : ''}${Math.abs(pct).toFixed(1)}%</span> <span class="reading-note">vs prior quarter</span>`;
}
function renderReadings() {
  const l = state.report.latest, m = state.report.metrics;
  const items = [
    ['Total assets', fmtMoney(l.assets), deltaHTML(quarterChange('assets'))],
    ['Total deposits', fmtMoney(l.deposits), deltaHTML(quarterChange('deposits'))],
    ['Equity / assets', fmtPct(m.equity_assets_pct), '<span class="reading-note">Accounting capital</span>'],
    ['Total risk-based capital', fmtPct(m.risk_based_capital_pct), '<span class="reading-note">Regulatory, as reported</span>'],
    ['Noncurrent loans', fmtPct(m.noncurrent_loans_pct), '<span class="reading-note">Share of gross loans</span>'],
  ];
  $('readings').innerHTML = items.map(([label, val, note]) => `<div class="reading"><div class="reading-label">${esc(label)}</div><div class="reading-value">${esc(val)}</div><div>${note}</div></div>`).join('');
}
function niceStep(max) {
  const raw = max / 5, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
function axisMoney(thousands) {
  const d = thousands * 1000;
  if (d === 0) return '$0';
  if (d >= 1e12) return `$${+(d / 1e12).toFixed(1)}T`;
  if (d >= 1e9) return `$${+(d / 1e9).toFixed(0)}B`;
  return `$${+(d / 1e6).toFixed(0)}M`;
}
function renderChart() {
  const items = state.report.history.slice(-8).filter((r) => isNum(r.assets) && isNum(r.deposits));
  const box = $('history-chart');
  if (items.length < 2) { box.innerHTML = '<p class="empty">Not enough reported quarters to draw a trend.</p>'; $('yoy-table').innerHTML = ''; return; }
  const W = Math.max(300, Math.round(box.clientWidth || 640)), H = W < 480 ? 230 : 280, L = 48, R = 62, T = 12, B = 30;
  const vw = W - L - R, vh = H - T - B;
  const top = Math.max(...items.map((d) => Number(d.assets)));
  const step = niceStep(top), max = Math.ceil(top / step) * step;
  const x = (i) => L + (i / (items.length - 1)) * vw, y = (v) => T + (1 - v / max) * vh;
  const path = (k) => items.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(d[k])).toFixed(1)}`).join(' ');
  let grid = '';
  for (let v = 0; v <= max + 1e-6; v += step) {
    const yy = y(v).toFixed(1);
    grid += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" ${v === 0 ? '' : 'stroke-dasharray="2 4"'}/><text class="axis-text" x="${L - 10}" y="${+yy + 4}" text-anchor="end">${axisMoney(v)}</text>`;
  }
  const skip = W < 480 ? 2 : 1;
  const ticks = items.map((d, i) => ((items.length - 1 - i) % skip ? '' : `<text class="axis-text" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(fmtQuarter(d.date))}</text>`)).join('');
  const dots = (k, cls) => items.map((d, i) => `<circle class="${cls}" cx="${x(i).toFixed(1)}" cy="${y(Number(d[k])).toFixed(1)}" r="3.5" stroke-width="2"><title>${esc(fmtDate(d.date))}: ${esc(fmtMoney(d[k]))}</title></circle>`).join('');
  const last = items[items.length - 1], endA = y(Number(last.assets)), endD = y(Number(last.deposits));
  const ea = Math.min(endA, endD - 16), ed = Math.max(endD, endA + 16);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total assets and total deposits for the last ${items.length} quarters. Latest: assets ${esc(fmtMoney(last.assets))}, deposits ${esc(fmtMoney(last.deposits))}.">${grid}
    <path class="area-assets" d="${path('assets')} L${x(items.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z"/>
    <path class="series-assets" d="${path('assets')}" fill="none" stroke-width="2.25" stroke-linejoin="round"/>
    <path class="series-deposits" d="${path('deposits')}" fill="none" stroke-width="2.25" stroke-linejoin="round"/>
    ${dots('assets', 'dot-assets')}${dots('deposits', 'dot-deposits')}
    <text class="end-assets" x="${W - R + 10}" y="${ea + 4}">${esc(fmtMoney(last.assets))}</text>
    <text class="end-deposits" x="${W - R + 10}" y="${ed + 4}">${esc(fmtMoney(last.deposits))}</text>${ticks}</svg>`;
  const h = state.report.history, cur = h[h.length - 1], ago = h.length >= 5 ? h[h.length - 5] : null;
  const yoy = (k) => (ago && isNum(cur[k]) && isNum(ago[k]) && Number(ago[k]) !== 0 ? (Number(cur[k]) / Number(ago[k]) - 1) * 100 : null);
  const chg = (p) => (p === null ? '<span class="muted">n/a</span>' : `<span class="delta ${Math.abs(p) < 0.05 ? 'flat' : p > 0 ? 'up' : 'down'}">${p > 0 ? '+' : p < 0 ? MINUS : ''}${Math.abs(p).toFixed(1)}%</span>`);
  $('yoy-table').innerHTML = `<thead><tr><th scope="col">Balance</th><th scope="col">${esc(fmtQuarter(cur.date))}</th><th scope="col">${ago ? esc(fmtQuarter(ago.date)) : 'Year ago'}</th><th scope="col">Change</th></tr></thead><tbody>${
    [['Total assets', 'assets'], ['Total deposits', 'deposits'], ['Gross loans', 'loans'], ['Equity capital', 'equity'], ['Cash and balances', 'cash']].map(([n, k]) =>
      `<tr><th scope="row">${n}</th><td>${esc(fmtMoney(cur[k]))}</td><td>${ago ? esc(fmtMoney(ago[k])) : 'n/a'}</td><td>${chg(yoy(k))}</td></tr>`).join('')}</tbody>`;
  setText('chart-foot', isDemo() ? 'Fictional figures. Axis starts at zero so changes are shown at true scale.' : 'Source: FDIC BankFind quarterly financials. Axis starts at zero so changes are shown at true scale.');
}
const GAUGE = {
  equity_assets_pct: { name: 'Equity / assets', max: 16, unit: 'floor' },
  uninsured_domestic_pct: { name: 'Uninsured share of domestic deposits', max: 100, unit: 'ceiling' },
  cash_deposits_pct: { name: 'Cash / deposits', max: 30, unit: 'floor' },
  loans_deposits_pct: { name: 'Loans / deposits', max: 140, unit: 'ceiling' },
  noncurrent_loans_pct: { name: 'Noncurrent loans', max: 5, unit: 'ceiling' },
};
function renderChecks() {
  const signals = state.report.signals || [], watch = signals.filter((s) => s.flag).length, count = $('check-count');
  count.textContent = signals.length ? `${watch} of ${signals.length} on watch` : 'No data';
  count.classList.toggle('has-watch', watch > 0);
  if (!signals.length) { $('checks').innerHTML = '<p class="empty">None of the screened fields were reported for this quarter.</p>'; return; }
  $('checks').innerHTML = signals.map((s) => {
    const g = GAUGE[s.metric] || { name: s.label, max: Math.max(s.threshold * 2, s.value * 1.2), unit: 'ceiling' };
    const max = Math.max(g.max, s.value * 1.05, s.threshold * 1.1), pos = (v) => Math.min(100, Math.max(0, (v / max) * 100));
    const below = g.unit === 'floor', t = pos(s.threshold), margin = Math.abs(s.value - s.threshold).toFixed(2);
    const zone = below ? `<span class="gauge-zone left" style="width:${t}%"></span>` : `<span class="gauge-zone right" style="width:${100 - t}%"></span>`;
    const rel = below ? `${margin} pts ${s.flag ? 'below' : 'above'} the ${s.threshold}% floor` : `${margin} pts ${s.flag ? 'above' : 'under'} the ${s.threshold}% ceiling`;
    return `<div class="check ${s.flag ? 'watch' : ''}"><div class="check-top"><span class="check-name">${esc(g.name)}</span><span class="check-value">${fmtPct(s.value)}</span></div>
      <div class="gauge" role="img" aria-label="${esc(g.name)} ${fmtPct(s.value)}; ${esc(rel)}">${zone}<span class="gauge-threshold" style="left:calc(${t}% - 1px)"></span><span class="gauge-mark" style="left:${pos(s.value)}%"></span></div>
      <div class="check-meta"><span>${esc(rel)}</span><span class="check-status">${s.flag ? 'Watch' : 'Within range'}</span></div></div>`;
  }).join('');
}
const INDICATORS = [
  ['Capital', [['risk_based_capital_pct', 'Total risk-based capital ratio', 'Prompt Corrective Action measure', 'reported'], ['equity_assets_pct', 'Equity / assets', 'Equity capital ÷ total assets', 'derived']]],
  ['Liquidity and funding', [['cash_deposits_pct', 'Cash / deposits', 'Cash and due from banks ÷ total deposits', 'derived'], ['loans_deposits_pct', 'Loans / deposits', 'Gross loans and leases ÷ total deposits', 'derived'], ['uninsured_domestic_pct', 'Uninsured domestic deposits', 'Estimated uninsured ÷ domestic deposits', 'derived']]],
  ['Asset quality', [['noncurrent_loans_pct', 'Noncurrent loans', '90+ days past due or nonaccrual ÷ gross loans', 'reported']]],
  ['Earnings', [['roa_pct', 'Return on assets', 'Annualized year-to-date net income ÷ average assets', 'reported'], ['roe_pct', 'Return on equity', 'Annualized year-to-date net income ÷ average equity', 'reported'], ['nim_pct', 'Net interest margin', 'Annualized year-to-date', 'reported']]],
];
function renderIndicators() {
  const m = state.report.metrics;
  $('indicator-table').innerHTML = INDICATORS.map(([group, rows]) => `<section class="group"><h3>${esc(group)}</h3>${rows.map(([k, name, def, origin]) =>
    `<div class="ind"><span class="ind-name">${esc(name)}</span><span class="ind-value">${fmtPct(m[k])}</span><span class="ind-def">${esc(def)}</span><span class="ind-origin ${origin}">${origin === 'derived' ? 'Derived' : 'FDIC reported'}</span></div>`).join('')}</section>`).join('');
}

/* ================= detail: stress ================= */
const ratio = (a, b) => (isNum(a) && isNum(b) && Number(b) !== 0 ? (Number(a) / Number(b)) * 100 : null);
/** Mirrors bankcore/analytics.py::stress_test exactly. Inputs in USD thousands. */
function scenario(rec, runoff, lossPct) {
  const n = (v) => (isNum(v) ? Number(v) : null);
  const u = n(rec.uninsured_deposits), cash = n(rec.cash), loans = n(rec.loans), equity = n(rec.equity), assets = n(rec.assets);
  const outflow = u === null ? null : (u * runoff) / 100;
  const remaining = cash === null || outflow === null ? null : cash - outflow;
  const credit = loans === null ? null : (loans * lossPct) / 100;
  const newEquity = equity === null || credit === null ? null : equity - credit;
  const newAssets = assets === null || credit === null ? null : assets - credit;
  return {
    assumed_deposit_outflow: outflow, cash_after_outflow: remaining,
    cash_only_funding_gap: remaining === null ? null : Math.max(0, -remaining),
    credit_loss: credit, equity_after_credit_loss: newEquity,
    equity_assets_before_pct: ratio(equity, assets),
    equity_assets_after_pct: newEquity === null || newAssets === null ? null : ratio(newEquity, newAssets),
  };
}
const currentScenario = () => scenario(state.report.latest, Number($('runoff-slider').value), Number($('loss-slider').value));
function bar(label, thousands, scale, cls) {
  const w = isNum(thousands) && scale > 0 ? Math.max(0, Math.min(100, (Number(thousands) / scale) * 100)) : 0;
  return `<div class="bar-row"><span class="bar-label">${esc(label)}</span><span class="bar-track"><span class="bar-fill ${cls}" style="width:${w}%"></span></span><span class="bar-value">${esc(fmtMoney(thousands))}</span></div>`;
}
function renderStress() {
  if (!state.report) return;
  const runoff = Number($('runoff-slider').value), loss = Number($('loss-slider').value);
  setText('runoff-label', `${runoff}%`); setText('loss-label', `${loss.toFixed(2)}%`);
  for (const id of ['runoff-slider', 'loss-slider']) { const s = $(id); s.style.setProperty('--fill', `${((s.value - s.min) / (s.max - s.min)) * 100}%`); }
  for (const c of $('presets').querySelectorAll('button')) c.setAttribute('aria-pressed', String(Number(c.dataset.runoff) === runoff && Number(c.dataset.loss) === loss));
  const l = state.report.latest, s = currentScenario();
  if (s.cash_after_outflow === null) {
    $('liquidity-result').innerHTML = '<p class="empty">Cash or uninsured deposits were not reported for this quarter, so the liquidity scenario cannot be calculated.</p>';
  } else {
    const gap = s.cash_only_funding_gap > 0, cover = s.assumed_deposit_outflow > 0 ? (Number(l.cash) / s.assumed_deposit_outflow) * 100 : null;
    const scale = Math.max(Number(l.cash), s.assumed_deposit_outflow);
    $('liquidity-result').innerHTML = `<div class="result-head"><span class="result-figure ${gap ? 'negative' : ''}">${esc(fmtMoney(gap ? s.cash_only_funding_gap : s.cash_after_outflow))}</span><span class="result-caption">${gap ? 'cash-only gap: outflow exceeds cash on hand' : 'cash remaining after the outflow'}</span></div>
      <div class="bars">${bar('Deposit outflow', s.assumed_deposit_outflow, scale, 'outflow')}${bar('Cash and balances', l.cash, scale, '')}</div>
      <dl class="result-lines"><div><dt>Uninsured domestic deposits</dt><dd>${esc(fmtMoney(l.uninsured_deposits))}</dd></div><div><dt>Cash covers outflow</dt><dd>${cover === null ? 'No outflow' : cover >= 999 ? '999%+' : `${cover.toFixed(0)}%`}</dd></div><div><dt>Cash after outflow</dt><dd>${esc(fmtMoney(s.cash_after_outflow))}</dd></div></dl>`;
  }
  if (s.equity_assets_after_pct === null) {
    $('capital-result').innerHTML = '<p class="empty">Equity, assets or loans were not reported for this quarter, so the capital scenario cannot be calculated.</p>';
  } else {
    const drop = s.equity_assets_before_pct - s.equity_assets_after_pct, scale = Math.max(Number(l.equity), 1);
    $('capital-result').innerHTML = `<div class="result-head"><span class="result-figure ${s.equity_assets_after_pct < 0 ? 'negative' : ''}">${fmtPct(s.equity_assets_after_pct)}</span><span class="result-caption">equity / assets after the loss, down ${drop.toFixed(2)} pts from ${fmtPct(s.equity_assets_before_pct)}</span></div>
      <div class="bars">${bar('Equity before', l.equity, scale, '')}${bar('Equity after', Math.max(0, s.equity_after_credit_loss), scale, 'after')}</div>
      <dl class="result-lines"><div><dt>Gross loans</dt><dd>${esc(fmtMoney(l.loans))}</dd></div><div><dt>Credit loss</dt><dd>${esc(fmtMoney(s.credit_loss))}</dd></div><div><dt>Loss as share of equity</dt><dd>${fmtPct(ratio(s.credit_loss, l.equity), 1)}</dd></div></dl>`;
  }
}
for (const id of ['runoff-slider', 'loss-slider']) $(id).addEventListener('input', renderStress);
for (const c of $('presets').querySelectorAll('button')) c.addEventListener('click', () => { $('runoff-slider').value = c.dataset.runoff; $('loss-slider').value = c.dataset.loss; renderStress(); });

/* ================= detail: research ================= */
function renderBrief() {
  const b = state.brief;
  if (!b) { $('rules-report').innerHTML = '<p class="muted">No brief was published for this bank.</p>'; return; }
  const flags = b.monitoring_flags.length ? `<ul>${b.monitoring_flags.map((f) => `<li class="flag-item">${esc(f)}</li>`).join('')}</ul>` : '<p>No screening thresholds were crossed among the fields reported this quarter.</p>';
  $('rules-report').innerHTML = `<p class="memo-meta">${esc(isDemo() ? 'Fictional data' : 'FDIC quarterly data')}, quarter ended ${esc(fmtDate(state.report.as_of))}</p>
    <h3>Key figures</h3><ul>${b.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><h3>On watch</h3>${flags}
    <h3>Interpretation</h3><p>${esc(b.interpretation)}</p><h3>Limitations</h3><p>${esc(b.limitations)}</p>`;
}
function setAI(status, html) { const t = $('ai-tag'); t.textContent = status; t.classList.toggle('on', status === 'Published'); $('ai-answer').innerHTML = html; }
async function renderAI(cert, request) {
  state.aiText = '';
  if (isDemo()) { setAI('Not applicable', '<p class="muted">AI notes are generated only for real FDIC institutions. Pick any bank from the dashboard to see whether one has been published.</p>'); return; }
  setAI('Checking', '<p class="muted">Looking for a published AI note.</p>');
  try {
    const ai = await getJSON(`./data/ai_${Number(cert)}.json`);
    if (request !== state.load) return;
    if (ai.bank_as_of !== state.report.as_of || !ai.is_ai_generated) throw new Error('stale');
    state.aiText = ai.answer;
    setAI('Published', `<p class="memo-meta">Model ${esc(ai.model)}, generated ${esc(fmtBuildTime(ai.generated_at_utc) || ai.generated_at_utc)}</p><div class="ai-body"></div><p class="foot-note">Model commentary can be wrong. Check every figure against the Overview tab before relying on it.</p>`);
    $('ai-answer').querySelector('.ai-body').textContent = ai.answer;
  } catch {
    if (request !== state.load) return;
    setAI('Not published', '<p class="muted">No AI note has been published for this bank yet. The evidence brief works without one. To publish notes, add an <code>AI_API_KEY</code> repository secret and run the Publish BankScope workflow.</p>');
  }
}

/* ================= detail: load a bank ================= */
function showError(msg) { const e = $('error'); e.textContent = msg || ''; e.hidden = !msg; }
function renderFacts(inst) {
  const demo = isDemo();
  const rows = demo
    ? [['FDIC certificate', 'None (fictional)'], ['Quarter ended', fmtDate(state.report.as_of)], ['Source', 'Invented figures']]
    : [
      ['FDIC certificate', String(inst.cert)],
      [inst.status === 'failed' ? 'Last report' : 'Quarter ended', fmtDate(state.report.as_of)],
      ['Headquarters', place(inst) || 'Not listed'],
      ['Primary regulator', REGULATORS[inst.regulator] || inst.regulator || 'Not listed'],
      ['Holding company', inst.holding_company || 'None listed'],
      ...(inst.asset_rank ? [['Size rank', `#${inst.asset_rank} by total assets`]] : []),
    ];
  $('facts').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}
async function loadBank(cert) {
  if (!bankByCert(cert)) { showError('That bank is not in the published dataset. Choose one from the dashboard.'); return; }
  const request = ++state.load;
  showError(''); $('loading').hidden = false;
  try {
    const data = Number(cert) === DEMO_CERT && window.BANKSCOPE_DEMO ? window.BANKSCOPE_DEMO : await getJSON(`./data/bank_${Number(cert)}.json`);
    if (request !== state.load) return;
    if (!data?.report?.history?.length || !data.brief) throw new Error('the file is missing report or brief data');
    state.report = data.report; state.brief = data.brief; state.cert = Number(cert);
    const meta = { ...bankByCert(cert), ...data.report.institution };
    $('bank-select').value = String(cert);
    const demo = isDemo(), failed = meta.status === 'failed', name = demo ? 'Northstar Regional Bank' : displayName(meta);
    setText('bank-name', name); setText('crumb-name', name);
    setText('bank-kicker', demo ? 'Fictional demo bank' : failed ? 'Failed bank · case study' : 'FDIC-insured bank');
    document.title = `${demo ? 'Northstar Regional Bank (fictional)' : name} · BankScope AI`;
    renderFacts(meta);
    const notice = $('notice');
    if (demo) {
      notice.className = 'notice notice-demo';
      notice.innerHTML = '<strong>Fictional data</strong><span>Northstar Regional Bank and its financial statements are invented for demonstration. No real institution is represented.</span>';
    } else if (meta.status === 'inactive') {
      notice.className = 'notice notice-demo';
      notice.innerHTML = `<strong>Charter inactive</strong><span>The FDIC lists this charter as inactive since ${esc(fmtDate(meta.inactive_since))}. These figures are from its last report, for the quarter ended ${esc(fmtDate(state.report.as_of))}.</span>`;
    } else if (failed) {
      notice.className = 'notice notice-fail';
      notice.innerHTML = `<strong>Failed ${esc(fmtDate(meta.failed_on))}</strong><span>These figures are from the bank's last report to the FDIC, for the quarter ended ${esc(fmtDate(state.report.as_of))}. The stress test applies to that balance sheet.</span>`;
    }
    notice.hidden = !(demo || failed || meta.status === 'inactive');
    renderReadings(); renderChart(); renderChecks(); renderIndicators();
    $('runoff-slider').value = 25; $('loss-slider').value = 2;
    renderStress(); renderBrief(); writeHash();
    await renderAI(cert, request);
  } catch (e) {
    if (request === state.load) showError(`Could not open this bank's data (${e.message}). Try another institution, or re-run the Publish BankScope workflow.`);
  } finally {
    if (request === state.load) $('loading').hidden = true;
  }
}
$('bank-select').addEventListener('change', (e) => openBank(e.target.value, state.view));

/* ================= export ================= */
$('export-button').addEventListener('click', () => {
  const r = state.report, b = state.brief;
  if (!r || !b) return;
  const s = currentScenario(), inst = { ...bankByCert(r.institution.cert), ...r.institution };
  const lines = [
    `# BankScope AI research brief: ${isDemo() ? 'Northstar Regional Bank (fictional)' : displayName(inst)}`, '',
    isDemo() ? '**Fictional data. This is not a real bank.**' : `Source: FDIC BankFind quarterly financials, bank-charter level (FDIC certificate ${inst.cert}, legal name ${inst.name})`,
    ...(inst.status === 'failed' ? [`**Failed ${fmtDate(inst.failed_on)}.** Figures are from its last report before failure.`] : []),
    `Quarter ended: ${fmtDate(r.as_of)}`,
    ...(place(inst) ? [`Headquarters: ${place(inst)}`] : []),
    ...(inst.holding_company ? [`Holding company: ${inst.holding_company}`] : []),
    `Dataset built: ${fmtBuildTime(state.manifest.generated_at_utc) || 'unknown'}`,
    '', '## Snapshot',
    `- Total assets: ${fmtMoney(r.latest.assets)}`, `- Total deposits: ${fmtMoney(r.latest.deposits)}`,
    `- Equity / assets: ${fmtPct(r.metrics.equity_assets_pct)}`, `- Total risk-based capital ratio: ${fmtPct(r.metrics.risk_based_capital_pct)}`,
    `- Uninsured share of domestic deposits: ${fmtPct(r.metrics.uninsured_domestic_pct)}`, `- Noncurrent loans: ${fmtPct(r.metrics.noncurrent_loans_pct)}`,
    '', '## Evidence brief (rules-based)', ...b.points.map((p) => `- ${p}`),
    '', '### On watch', ...(b.monitoring_flags.length ? b.monitoring_flags.map((f) => `- ${f}`) : ['- No screening thresholds crossed']),
    '', b.interpretation, '', '## Stress scenario (hypothetical)',
    `- Uninsured deposit runoff: ${$('runoff-slider').value}% (outflow ${fmtMoney(s.assumed_deposit_outflow)})`,
    `- Cash after outflow: ${fmtMoney(s.cash_after_outflow)}; cash-only gap: ${fmtMoney(s.cash_only_funding_gap)}`,
    `- Credit loss on loans: ${Number($('loss-slider').value).toFixed(2)}% (${fmtMoney(s.credit_loss)})`,
    `- Equity / assets: ${fmtPct(s.equity_assets_before_pct)} before, ${fmtPct(s.equity_assets_after_pct)} after`,
    '- Excludes securities, borrowing capacity, foreign-office deposits, taxes, risk-weighted assets and management actions.',
    ...(state.aiText ? ['', '## AI research note (model-generated; verify every figure)', state.aiText] : []),
    '', '## Limitations', b.limitations, '', '---',
    'BankScope AI, FIN 414 class project at Bryant University. Not investment, legal or regulatory advice.',
    'FDIC API documentation: https://api.fdic.gov/banks/docs',
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `bankscope_${inst.cert}_${r.as_of}.md` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ================= start ================= */
function renderSelect() {
  const act = [...activeBanks()].sort((a, b) => (a.asset_rank || 999) - (b.asset_rank || 999));
  const opt = (b, label) => `<option value="${Number(b.cert)}">${esc(label || displayName(b))}</option>`;
  $('bank-select').innerHTML =
    (act.length ? `<optgroup label="Largest banks by assets">${act.map((b) => opt(b, `${b.asset_rank ? `${b.asset_rank}. ` : ''}${displayName(b)}`)).join('')}</optgroup>` : '') +
    (failedBanks().length ? `<optgroup label="Failed banks (case studies)">${failedBanks().map((b) => opt(b)).join('')}</optgroup>` : '') +
    `<optgroup label="Demonstration">${banks().filter((b) => b.mode === 'demo').map((b) => opt(b, 'Northstar Regional Bank (fictional)')).join('')}</optgroup>`;
  const built = fmtBuildTime(state.manifest.generated_at_utc);
  setText('build-meta', `Last build: ${built || 'unknown'}. Institutions: ${realBanks().length}. Data mode: ${state.manifest.build_mode === 'fdic_api' ? 'live FDIC API' : 'offline demo'}. AI notes: ${state.manifest.ai_enabled ? 'published' : 'not configured'}.`);
}
let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!$('home').hidden) renderMap();
    else if (state.report && state.view === 'overview') renderChart();
  }, 150);
});

(async function init() {
  tiles.start();
  try {
    state.manifest = await getJSON('./data/manifest.json');
  } catch {
    state.manifest.generated_at_utc = null; // opened locally without data: demo only
  }
  if (state.manifest.warnings?.length) console.warn('BankScope build warnings:', state.manifest.warnings);
  renderSelect(); renderStats(); renderTicker(); renderMap(); renderTable(); renderCases();
  if (!realBanks().length) setText('hero-copy', 'This build could not reach the FDIC, so only the fictional demo bank is available. Re-run the Publish BankScope workflow to load real institutions.');
  await route();
})();
