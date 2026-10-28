/* BankScope AI front end. Data is precomputed in Python (bankcore/, scripts/build_data.py)
   by GitHub Actions; the browser formats it and recalculates interactive stress scenarios. */
'use strict';

const $ = (id) => document.getElementById(id);
const DEMO_CERT = 999999;
const VIEWS = ['overview', 'stress', 'research', 'method'];
// Same educational thresholds as bankcore/analytics.py WATCH_THRESHOLDS.
// Screening thresholds come from the build (manifest.thresholds, defined in bankcore/analytics.py).
// This copy is only a fallback for local previews without a manifest.
let THRESHOLDS = {
  tier1_leverage_pct: ['below', 5, 'regulatory'], cet1_pct: ['below', 6.5, 'regulatory'], risk_based_capital_pct: ['below', 10, 'regulatory'],
  liquid_coverage_pct: ['below', 35, 'heuristic'], htm_loss_equity_pct: ['above', 25, 'heuristic'],
  noncurrent_loans_pct: ['above', 2, 'heuristic'], loans_deposits_pct: ['above', 95, 'heuristic'],
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

/* ================= hero tiles =================
   Same technique as the LDB Finance hero: a grid of small "windows", each fading on its own
   seeded sine wave, drawn at about 24 frames a second. Seeding by grid position means a resize
   redraws the same pattern instead of reshuffling it. Paused off screen and in hidden tabs. */
const tiles = (() => {
  const cv = $('hero-tiles'), ctx = cv.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SX = 16, SY = 15, TW = 10, TH = 6, t0 = performance.now();
  let list = [], W = 0, H = 0, run = false, vis = true, last = 0;
  const seed = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function size() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    list = [];
    const cols = Math.ceil(W / SX) + 1, rows = Math.ceil(H / SY) + 1;
    for (let y = 0, k = 0; y < rows; y++) for (let x = 0; x < cols; x++, k++) {
      // Key the seed on (row, column) so tiles keep their rhythm when the width changes.
      const id = y * 1000 + x, a = seed(id), b = seed(id + 9973), c = seed(id + 19997);
      list.push({ x: x * SX + 3, y: y * SY + 4, base: 0.05 + a * 0.07, peak: c < 0.22 ? 0.55 + b * 0.4 : 0.14 + b * 0.12, sp: 0.05 + b * 0.16, ph: a * 6.283 });
    }
    draw(performance.now());
  }
  function draw(now) {
    const lt = document.documentElement.classList.contains('lt'), t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = lt ? 'rgb(31,91,151)' : 'rgb(116,169,221)';
    const k = lt ? 0.5 : 1;
    for (const p of list) {
      const s = still ? 0.5 : Math.max(0, Math.sin(t * p.sp * 6.283 + p.ph));
      ctx.globalAlpha = (p.base + (p.peak - p.base) * s * s * s) * k;
      ctx.fillRect(p.x, p.y, TW, TH);
    }
    ctx.globalAlpha = 1;
  }
  function loop(now) {
    if (!run) return;
    if (now - last > 41) { last = now; draw(now); }
    requestAnimationFrame(loop);
  }
  function go() {
    const want = vis && !document.hidden && !still && !$('home').hidden;
    if (want && !run) { run = true; requestAnimationFrame(loop); } else if (!want) run = false;
  }
  function start() {
    size();
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(size, 150); });
    document.addEventListener('visibilitychange', go);
    new IntersectionObserver((e) => { vis = e[0].isIntersecting; go(); }).observe(cv);
    go();
  }
  return { start, redraw: () => draw(performance.now()), go, size };
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
    tiles.size(); tiles.go();
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
  tiles.go();
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
  const corner = act.filter(inCorner).length;
  const q = latestQuarter();
  const items = act.length ? [
    ['Institutions', String(realBanks().length), `${act.length} largest by assets, ${fail.length} failed`],
    ['Combined assets', fmtMoney(sum('assets')), `${act.length} operating banks`],
    ['Median CET1 ratio', dash(median(act.map((b) => b.summary?.cet1_pct)), 1), 'Well capitalized at 6.5%'],
    ['Median liquid coverage', dash(median(act.map((b) => b.summary?.liquid_coverage_pct)), 0), 'Cash + AFS ÷ runnable deposits'],
    ['Median hidden HTM loss', dash(median(act.map((b) => b.summary?.htm_loss_equity_pct)), 1), 'As a share of equity'],
    ['Run-risk corner', `${corner} of ${act.length}`, 'Both liquidity screens crossed'],
  ] : [['Institutions', '0', 'No FDIC data in this build'], ['Demo bank', '1', 'Fictional data available']];
  $('stats').innerHTML = items.map(([l, v, n]) => `<div class="stat"><div class="stat-label">${esc(l)}</div><div class="stat-value">${esc(v)}</div><div class="stat-note">${esc(n)}</div></div>`).join('');
  const built = fmtBuildTime(state.manifest.generated_at_utc);
  setText('sys-note', act.length
    ? `FDIC quarterly data, ${q ? fmtQuarter(q, true) : 'latest quarter'}. Built ${built || 'recently'} by GitHub Actions.`
    : 'This build has no FDIC data. Only the fictional demo bank is available.');
}
/** Low liquid coverage AND large hidden HTM losses: the combination behind the 2023 runs. */
function inCorner(b) {
  return crosses('liquid_coverage_pct', b.summary?.liquid_coverage_pct) && crosses('htm_loss_equity_pct', b.summary?.htm_loss_equity_pct);
}

/* ================= home: ticker ================= */
function renderTicker() {
  const act = [...activeBanks()].sort((a, b) => (a.asset_rank || 999) - (b.asset_rank || 999));
  const q = latestQuarter();
  const short = (b) => displayName(b).replace(/,? (N\.A\.|National Association)$/i, '');
  const items = [
    q ? `<span class="tk-asof">● As of ${esc(fmtQuarter(q, true))}</span>` : '',
    ...act.map((b) => `<span><span class="tk-name">${esc(short(b))}</span> ${esc(fmtMoney(b.summary?.assets))} <span class="tk-lbl">CET1</span> <span class="${crosses('cet1_pct', b.summary?.cet1_pct) ? 'tk-dn' : 'tk-up'}">${esc(dash(b.summary?.cet1_pct, 1))}</span></span>`),
    ...failedBanks().map((b) => `<span><span class="tk-fail">Failed ${esc(fmtDate(b.failed_on, { month: 'short', year: 'numeric' }))}</span> <span class="tk-name">${esc(short(b))}</span> <span class="tk-lbl">Hidden HTM loss</span> <span class="tk-dn">${esc(dash(b.summary?.htm_loss_equity_pct, 0))} of equity</span></span>`),
  ].filter(Boolean).join('');
  $('ticker-track').innerHTML = items + items; // duplicated for a seamless loop
  // Constant reading speed regardless of how many banks are listed (~30 px per second).
  requestAnimationFrame(() => {
    const half = $('ticker-track').scrollWidth / 2;
    $('ticker-track').style.setProperty('--tick-dur', `${Math.max(60, Math.round(half / 30))}s`);
  });
  $('ticker').hidden = !act.length;
}

/* ================= home: run-risk map ================= */
function renderMap() {
  const X = 'htm_loss_equity_pct', Y = 'liquid_coverage_pct';
  const pts = realBanks().filter((b) => isNum(b.summary?.[X]) && isNum(b.summary?.[Y]));
  const box = $('map-chart');
  if (!pts.length) { box.innerHTML = '<p class="empty">No institutions with both securities and liquidity data in this build.</p>'; return; }
  const W = Math.max(320, Math.round(box.clientWidth || 760)), H = W < 520 ? 330 : 430;
  const L = 52, R = 18, T = 14, B = 48, vw = W - L - R, vh = H - T - B;
  const XMAX = 100, YMAX = 200;
  // Square-root scales spread out the crowded low end; values past the edge are pinned to it.
  const x = (v) => L + Math.sqrt(Math.min(XMAX, Math.max(0, v)) / XMAX) * vw;
  const y = (v) => T + (1 - Math.sqrt(Math.min(YMAX, Math.max(0, v)) / YMAX)) * vh;
  const maxA = Math.max(...pts.map((b) => Number(b.summary.assets) || 0), 1);
  const rad = (b) => 3.5 + Math.sqrt((Number(b.summary.assets) || 0) / maxA) * (W < 520 ? 14 : 20);
  const [tx, ty] = [THRESHOLDS[X][1], THRESHOLDS[Y][1]];
  let g = `<rect class="zone" x="${x(tx)}" y="${y(ty)}" width="${x(XMAX) - x(tx)}" height="${y(0) - y(ty)}"/>`;
  g += `<text class="zone-label" x="${x(XMAX) - 6}" y="${y(0) - 9}" text-anchor="end">HTM LOSS > ${tx}% OF EQUITY · COVERAGE < ${ty}%</text>`;
  for (const v of [0, 5, 10, 25, 50, 100]) g += `<line class="grid-line" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${T + vh}"/><text class="axis-text" x="${x(v)}" y="${T + vh + 18}" text-anchor="middle">${v}%</text>`;
  for (const v of [0, 10, 25, 50, 100, 200]) g += `<line class="grid-line" x1="${L}" x2="${L + vw}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${v === YMAX ? '200%+' : `${v}%`}</text>`;
  g += `<text class="axis-title" x="${L + vw / 2}" y="${H - 6}" text-anchor="middle">Unrealized HTM securities loss as a share of equity</text>`;
  g += `<text class="axis-title" transform="translate(13 ${T + vh / 2}) rotate(-90)" text-anchor="middle">Liquid coverage of runnable deposits</text>`;
  const order = [...pts].sort((a, b) => (Number(b.summary.assets) || 0) - (Number(a.summary.assets) || 0));
  const labeled = new Set([...failedBanks().map((b) => b.cert), ...(W < 520 ? [] : order.filter((b) => b.status !== 'failed').slice(0, 3).map((b) => b.cert))]);
  const short = (b) => displayName(b).replace(/,? (N\.A\.|National Association)$/i, '');
  const placed = [];
  const placeLabel = (txt, cx, cyy, r) => {
    const wpx = txt.length * 6.4 + 4, right = cx + r + 6 + wpx > L + vw;
    const x0 = right ? cx - r - 6 - wpx : cx + r + 6;
    for (const dy of [0, -15, 15, -30, 30, -45, 45]) {
      const bx = { x0, x1: x0 + wpx, y0: cyy + dy - 9, y1: cyy + dy + 5 };
      if (bx.y0 < T || bx.y1 > T + vh - 14) continue;
      if (!placed.some((p) => bx.x0 < p.x1 && bx.x1 > p.x0 && bx.y0 < p.y1 && bx.y1 > p.y0)) { placed.push(bx); return { x: right ? x0 + wpx : x0, y: cyy + dy + 4, anchor: right ? 'end' : 'start' }; }
    }
    return null;
  };
  const labelSvg = [];
  g += order.map((b) => {
    const s = b.summary, failed = b.status === 'failed', cx = x(s[X]), cyy = y(s[Y]), r = rad(b);
    const label = `${displayName(b)}: hidden HTM loss ${fmtPct(s[X], 1)} of equity, liquid coverage ${fmtPct(s[Y], 0)}${failed ? `, failed ${fmtDate(b.failed_on)}` : ''}`;
    const pos = labeled.has(b.cert) ? placeLabel(short(b), cx, cyy, r) : null;
    if (pos) labelSvg.push(`<text class="pt-label ${failed ? 'failed' : ''}" x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" text-anchor="${pos.anchor}">${esc(short(b))}</text>`);
    const pinned = Number(s[Y]) > YMAX || Number(s[X]) > XMAX;
    return `<a class="pt ${failed ? 'failed' : ''}${pinned ? ' pinned' : ''}" href="#bank=${Number(b.cert)}&amp;view=overview" data-cert="${Number(b.cert)}" aria-label="${esc(label)}"><circle cx="${cx.toFixed(1)}" cy="${cyy.toFixed(1)}" r="${r.toFixed(1)}"/></a>`;
  }).join('') + labelSvg.join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter chart of ${pts.length} banks: unrealized held-to-maturity loss against liquid coverage">${g}</svg>`;

  const tip = $('map-tip'), panel = box.closest('.map-panel');
  const show = (el) => {
    const b = bankByCert(el.dataset.cert); if (!b) return;
    const s = b.summary;
    tip.innerHTML = `<strong>${esc(displayName(b))}</strong><dl><dt>${b.status === 'failed' ? `Failed ${esc(fmtDate(b.failed_on))}` : `#${b.asset_rank || '—'} by assets`}</dt><dd>${esc(fmtMoney(s.assets))}</dd><dt>Liquid coverage</dt><dd>${esc(fmtPct(s[Y], 0))}</dd><dt>Hidden HTM loss</dt><dd>${esc(fmtPct(s[X], 1))} of equity</dd><dt>CET1 ratio</dt><dd>${esc(dash(s.cet1_pct, 1))}</dd><dt>Reported</dt><dd>${esc(fmtDate(b.as_of))}</dd></dl>`;
    tip.hidden = false;
    const pr = panel.getBoundingClientRect(), cr = el.getBoundingClientRect();
    let left = cr.right - pr.left + 10, top = cr.top - pr.top - 10;
    if (left + 240 > pr.width) left = cr.left - pr.left - 250;
    tip.style.left = `${Math.max(8, left)}px`; tip.style.top = `${Math.max(8, top)}px`;
  };
  for (const el of box.querySelectorAll('.pt')) {
    el.addEventListener('mouseenter', () => show(el));
    el.addEventListener('focus', () => show(el));
    el.addEventListener('mouseleave', () => { tip.hidden = true; });
    el.addEventListener('blur', () => { tip.hidden = true; });
  }

  const svb = failedBanks().filter((b) => isNum(b.summary?.[X])).sort((a, b) => b.summary[X] - a.summary[X])[0];
  const corner = activeBanks().filter(inCorner).length;
  $('map-callout').textContent = svb
    ? `${displayName(svb)}'s last report, for ${fmtDate(svb.as_of)}, showed unrecognized HTM losses equal to ${fmtPct(svb.summary[X], 0)} of its equity and liquid assets covering ${fmtPct(svb.summary[Y], 0)} of runnable deposits, while its CET1 ratio was ${dash(svb.summary.cet1_pct, 1)}. It failed on ${fmtDate(svb.failed_on)}. ${corner === 0 ? 'None' : corner} of today's ${activeBanks().length} largest banks ${corner === 1 ? 'sits' : 'sit'} in the shaded corner.`
    : '';
}

/* ================= home: institutions table ================= */
const COLS = [
  { key: 'rank', label: '#', get: (b) => b.asset_rank ?? null },
  { key: 'name', label: 'Institution', get: (b) => displayName(b) },
  { key: 'assets', label: 'Total assets', get: (b) => b.summary?.assets },
  { key: 'cet1_pct', label: 'CET1', get: (b) => b.summary?.cet1_pct, d: 1 },
  { key: 'tier1_leverage_pct', label: 'Leverage', get: (b) => b.summary?.tier1_leverage_pct, d: 1 },
  { key: 'uninsured_domestic_pct', label: 'Uninsured', get: (b) => b.summary?.uninsured_domestic_pct, d: 1 },
  { key: 'liquid_coverage_pct', label: 'Liquid cov.', get: (b) => b.summary?.liquid_coverage_pct, d: 0 },
  { key: 'htm_loss_equity_pct', label: 'HTM loss / eq.', get: (b) => b.summary?.htm_loss_equity_pct, d: 1 },
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
    ['CET1 ratio', fmtPct(m.cet1_pct), '<span class="reading-note">Regulatory, as reported</span>'],
    ['Liquid coverage', fmtPct(m.liquid_coverage_pct, 0), '<span class="reading-note">Cash + AFS ÷ runnable deposits</span>'],
    ['Hidden HTM loss', fmtMoney(m.htm_unrealized_loss), `<span class="reading-note">${isNum(m.htm_loss_equity_pct) ? `${fmtPct(m.htm_loss_equity_pct, 1)} of equity` : 'Not reported'}</span>`],
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
  tier1_leverage_pct: { name: 'Tier 1 leverage ratio', max: 15 },
  cet1_pct: { name: 'CET1 capital ratio', max: 20 },
  risk_based_capital_pct: { name: 'Total risk-based capital ratio', max: 25 },
  liquid_coverage_pct: { name: 'Liquid coverage of runnable deposits', max: 150 },
  htm_loss_equity_pct: { name: 'Hidden HTM loss as a share of equity', max: 100 },
  noncurrent_loans_pct: { name: 'Noncurrent loans', max: 5 },
  loans_deposits_pct: { name: 'Loans / deposits', max: 140 },
};
function checkHTML(s) {
  const g = GAUGE[s.metric] || { name: s.label, max: Math.max(s.threshold * 2, s.value * 1.2) };
  const max = Math.max(g.max, s.threshold * 1.1), shown = Math.min(s.value, max);
  const pos = (v) => Math.min(100, Math.max(0, (v / max) * 100));
  const below = (s.direction || THRESHOLDS[s.metric]?.[0]) === 'below', t = pos(s.threshold);
  const margin = Math.abs(s.value - s.threshold).toFixed(s.threshold >= 20 ? 1 : 2);
  const zone = below ? `<span class="gauge-zone left" style="width:${t}%"></span>` : `<span class="gauge-zone right" style="width:${100 - t}%"></span>`;
  const rel = below ? `${margin} pts ${s.flag ? 'below' : 'above'} the ${s.threshold}% floor` : `${margin} pts ${s.flag ? 'above' : 'under'} the ${s.threshold}% ceiling`;
  return `<div class="check ${s.flag ? 'watch' : ''}"><div class="check-top"><span class="check-name">${esc(g.name)}</span><span class="check-value">${fmtPct(s.value, s.value >= 100 ? 0 : 2)}${s.value > max ? '+' : ''}</span></div>
    <div class="gauge" role="img" aria-label="${esc(g.name)} ${fmtPct(s.value)}; ${esc(rel)}">${zone}<span class="gauge-threshold" style="left:calc(${t}% - 1px)"></span><span class="gauge-mark" style="left:${pos(shown)}%"></span></div>
    <div class="check-meta"><span>${esc(rel)}</span><span class="check-status">${s.flag ? 'Watch' : 'Within range'}</span></div></div>`;
}
function renderChecks() {
  const signals = state.report.signals || [], watch = signals.filter((s) => s.flag).length, count = $('check-count');
  count.textContent = signals.length ? `${watch} of ${signals.length} on watch` : 'No data';
  count.classList.toggle('has-watch', watch > 0);
  if (!signals.length) { $('checks').innerHTML = '<p class="empty">None of the screened fields were reported for this quarter.</p>'; return; }
  const kind = (s) => s.kind || THRESHOLDS[s.metric]?.[2] || 'heuristic';
  const group = (k, title, note) => {
    const list = signals.filter((s) => kind(s) === k);
    return list.length ? `<div class="check-group"><p class="check-group-title">${esc(title)}<span>${esc(note)}</span></p>${list.map(checkHTML).join('')}</div>` : '';
  };
  $('checks').innerHTML = group('regulatory', 'Regulatory benchmarks', 'Well-capitalized minimums under Prompt Corrective Action')
    + group('heuristic', 'Teaching heuristics', 'Thresholds chosen for this project');
}
const INDICATORS = [
  ['Capital', [
    ['cet1_pct', 'CET1 capital ratio', 'Common equity tier 1 ÷ risk-weighted assets', 'reported'],
    ['tier1_leverage_pct', 'Tier 1 leverage ratio', 'Tier 1 capital ÷ average total assets', 'reported'],
    ['risk_based_capital_pct', 'Total risk-based capital ratio', 'Total capital ÷ risk-weighted assets', 'reported'],
    ['equity_assets_pct', 'Equity / assets', 'Equity capital ÷ total assets (accounting)', 'derived'],
  ]],
  ['Liquidity and funding', [
    ['liquid_coverage_pct', 'Liquid coverage', 'Cash + AFS securities ÷ uninsured domestic and foreign deposits', 'derived', 0],
    ['uninsured_domestic_pct', 'Uninsured domestic deposits', 'Estimated uninsured ÷ domestic deposits', 'derived', 1],
    ['cash_deposits_pct', 'Cash / deposits', 'Cash and due from banks ÷ total deposits', 'derived', 1],
    ['loans_deposits_pct', 'Loans / deposits', 'Gross loans and leases ÷ total deposits', 'derived', 1],
  ]],
  ['Securities', [
    ['htm_unrealized_loss', 'Unrealized HTM loss', 'Held-to-maturity amortized cost − fair value; not in equity', 'derived', 'money'],
    ['htm_loss_equity_pct', 'HTM loss / equity', 'How much equity the hidden loss would absorb', 'derived', 1],
    ['afs_unrealized_loss', 'Unrealized AFS loss', 'Available-for-sale cost − fair value; already in equity', 'derived', 'money'],
  ]],
  ['Asset quality', [['noncurrent_loans_pct', 'Noncurrent loans', '90+ days past due or nonaccrual ÷ gross loans', 'reported']]],
  ['Earnings', [
    ['roa_pct', 'Return on assets', 'Annualized year-to-date net income ÷ average assets', 'reported'],
    ['roe_pct', 'Return on equity', 'Annualized year-to-date net income ÷ average equity', 'reported'],
    ['nim_pct', 'Net interest margin', 'Annualized year-to-date', 'reported'],
  ]],
];
function renderIndicators() {
  const m = state.report.metrics;
  const val = (k, d) => (d === 'money' ? fmtMoney(m[k]) : fmtPct(m[k], d ?? 2));
  $('indicator-table').innerHTML = INDICATORS.map(([group, rows]) => `<section class="group"><h3>${esc(group)}</h3>${rows.map(([k, name, def, origin, d]) =>
    `<div class="ind"><span class="ind-name">${esc(name)}</span><span class="ind-value">${esc(val(k, d))}</span><span class="ind-def">${esc(def)}</span><span class="ind-origin ${origin}">${origin === 'derived' ? 'Derived' : 'FDIC reported'}</span></div>`).join('')}</section>`).join('');
}

/* ================= detail: stress =================
   The math lives in site/scenario.js (mirror of bankcore/analytics.py, checked by tests/test_parity.py). */
const ratio = (a, b) => (isNum(a) && isNum(b) && Number(b) !== 0 ? (Number(a) / Number(b)) * 100 : null);
const scenarioOptions = () => ({
  deposit_runoff_pct: Number($('runoff-slider').value), credit_loss_pct: Number($('loss-slider').value),
  securities_haircut_pct: Number($('haircut-slider').value), include_foreign: $('opt-foreign').checked, allow_htm_sales: $('opt-htm').checked,
});
const currentScenario = () => window.BankScopeScenario.stressTest(state.report.latest, scenarioOptions());
function bar(label, thousands, scale, cls) {
  const w = isNum(thousands) && scale > 0 ? Math.max(0, Math.min(100, (Number(thousands) / scale) * 100)) : 0;
  return `<div class="bar-row"><span class="bar-label">${esc(label)}</span><span class="bar-track"><span class="bar-fill ${cls}" style="width:${w}%"></span></span><span class="bar-value">${esc(fmtMoney(thousands))}</span></div>`;
}
function stack(parts, total) {
  return `<div class="stack" role="img" aria-label="${esc(parts.map(([l, v]) => `${l} ${fmtMoney(v)}`).join(', '))}">${parts.map(([, v, cls]) =>
    `<span class="stack-seg ${cls}" style="width:${total > 0 ? Math.max(0, (v / total) * 100) : 0}%"></span>`).join('')}</div>
    <div class="stack-legend">${parts.filter(([, v]) => v > 0).map(([l, v, cls]) => `<span><i class="sw ${cls}"></i>${esc(l)} <b>${esc(fmtMoney(v))}</b></span>`).join('')}</div>`;
}
function renderStress() {
  if (!state.report) return;
  const o = scenarioOptions();
  setText('runoff-label', `${o.deposit_runoff_pct}%`); setText('loss-label', `${o.credit_loss_pct.toFixed(2)}%`); setText('haircut-label', `${o.securities_haircut_pct}%`);
  for (const id of ['runoff-slider', 'loss-slider', 'haircut-slider']) { const el = $(id); el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min)) * 100}%`); }
  for (const c of $('presets').querySelectorAll('button')) c.setAttribute('aria-pressed', String(Number(c.dataset.runoff) === o.deposit_runoff_pct && Number(c.dataset.loss) === o.credit_loss_pct && Number(c.dataset.haircut) === o.securities_haircut_pct));
  const l = state.report.latest, s = currentScenario();

  if (s.funding_gap === null) {
    $('liquidity-result').innerHTML = '<p class="empty">Cash or uninsured deposits were not reported for this quarter, so the liquidity scenario cannot be calculated.</p>';
  } else {
    const gap = s.funding_gap > 0.5;
    const parts = [['Cash', s.cash_used, 'seg-cash'], ['AFS sales', s.afs_proceeds, 'seg-afs'], ['HTM sales', s.htm_proceeds, 'seg-htm'], ['Unfunded', s.funding_gap, 'seg-gap']];
    const sold = (s.afs_sold || 0) + (s.htm_sold || 0);
    $('liquidity-result').innerHTML = `<div class="result-head"><span class="result-figure ${gap ? 'negative' : ''}">${esc(fmtMoney(gap ? s.funding_gap : s.assumed_deposit_outflow))}</span><span class="result-caption">${gap ? 'funding gap: the outflow exceeds everything the bank can sell under these settings' : `outflow met${sold > 0 ? ' by selling securities' : ' from cash'}`}</span></div>
      <p class="mini-label">How the ${esc(fmtMoney(s.assumed_deposit_outflow))} outflow is paid</p>${stack(parts, s.assumed_deposit_outflow)}
      <dl class="result-lines"><div><dt>Runnable deposits</dt><dd>${esc(fmtMoney(s.runnable_deposits))}</dd></div><div><dt>Securities sold</dt><dd>${esc(fmtMoney(sold))}</dd></div><div><dt>Cash alone covers</dt><dd>${s.assumed_deposit_outflow > 0 ? `${Math.min(999, (Number(l.cash) / s.assumed_deposit_outflow) * 100).toFixed(0)}%` : 'No outflow'}</dd></div></dl>`;
  }

  if (s.equity_after === null) {
    $('capital-result').innerHTML = '<p class="empty">Equity, assets or loans were not reported for this quarter, so the capital scenario cannot be calculated.</p>';
  } else {
    const secLoss = (s.haircut_loss || 0) + (s.realized_htm_loss || 0);
    const headline = isNum(s.cet1_after_pct) ? ['cet1', s.cet1_after_pct, s.cet1_before_pct, 'CET1 ratio after the shock (approximate)']
      : ['eq', s.equity_assets_after_pct, s.equity_assets_before_pct, 'equity / assets after the shock'];
    const neg = headline[1] < (headline[0] === 'cet1' ? THRESHOLDS.cet1_pct[1] : 0);
    const scale = Math.max(Number(l.equity), 1);
    $('capital-result').innerHTML = `<div class="result-head"><span class="result-figure ${neg ? 'negative' : ''}">${fmtPct(headline[1])}</span><span class="result-caption">${headline[3]}, from ${fmtPct(headline[2])}${headline[0] === 'cet1' && neg ? `; below the ${THRESHOLDS.cet1_pct[1]}% well-capitalized minimum` : ''}</span></div>
      <div class="bars">${bar('Equity before', l.equity, scale, '')}${bar('Equity after', Math.max(0, s.equity_after), scale, 'after')}</div>
      <dl class="result-lines result-lines-4"><div><dt>Credit loss</dt><dd>${esc(fmtMoney(s.credit_loss))}</dd></div><div><dt>Securities losses realized</dt><dd>${esc(fmtMoney(secLoss))}</dd></div><div><dt>Tier 1 leverage after</dt><dd>${esc(dash(s.tier1_leverage_after_pct))}</dd></div><div><dt>Equity / assets after</dt><dd>${esc(dash(s.equity_assets_after_pct))}</dd></div></dl>
      ${s.realized_htm_loss > 0 ? `<p class="foot-note">Selling ${esc(fmtMoney(s.htm_sold))} of held-to-maturity securities turned ${esc(fmtMoney(s.realized_htm_loss))} of previously hidden losses into real ones.</p>` : ''}`;
  }
}
for (const id of ['runoff-slider', 'loss-slider', 'haircut-slider']) $(id).addEventListener('input', renderStress);
for (const id of ['opt-foreign', 'opt-htm']) $(id).addEventListener('change', renderStress);
for (const c of $('presets').querySelectorAll('button')) c.addEventListener('click', () => {
  $('runoff-slider').value = c.dataset.runoff; $('loss-slider').value = c.dataset.loss; $('haircut-slider').value = c.dataset.haircut; renderStress();
});

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
    $('runoff-slider').value = 25; $('loss-slider').value = 2; $('haircut-slider').value = 5; $('opt-foreign').checked = true; $('opt-htm').checked = true;
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
    `- CET1 ratio: ${fmtPct(r.metrics.cet1_pct)}; Tier 1 leverage: ${fmtPct(r.metrics.tier1_leverage_pct)}; total risk-based capital: ${fmtPct(r.metrics.risk_based_capital_pct)}`,
    `- Liquid coverage of runnable deposits: ${fmtPct(r.metrics.liquid_coverage_pct, 0)}; uninsured share of domestic deposits: ${fmtPct(r.metrics.uninsured_domestic_pct, 1)}`,
    `- Unrealized HTM loss: ${fmtMoney(r.metrics.htm_unrealized_loss)} (${fmtPct(r.metrics.htm_loss_equity_pct, 1)} of equity); noncurrent loans: ${fmtPct(r.metrics.noncurrent_loans_pct)}`,
    '', '## Evidence brief (rules-based)', ...b.points.map((p) => `- ${p}`),
    '', '### On watch', ...(b.monitoring_flags.length ? b.monitoring_flags.map((f) => `- ${f}`) : ['- No screening thresholds crossed']),
    '', b.interpretation, '', '## Stress scenario (hypothetical)',
    `- Runoff: ${s.deposit_runoff_pct}% of ${s.include_foreign ? 'uninsured domestic and foreign-office' : 'uninsured domestic'} deposits (outflow ${fmtMoney(s.assumed_deposit_outflow)})`,
    `- Paid from cash ${fmtMoney(s.cash_used)}, AFS sales ${fmtMoney(s.afs_proceeds)}, HTM sales ${fmtMoney(s.htm_proceeds)}${s.allow_htm_sales ? '' : ' (HTM sales not allowed)'}; funding gap ${fmtMoney(s.funding_gap)}`,
    `- Securities haircut ${s.securities_haircut_pct}%; credit loss ${s.credit_loss_pct.toFixed(2)}% of loans (${fmtMoney(s.credit_loss)}); realized HTM loss ${fmtMoney(s.realized_htm_loss)}`,
    `- CET1 ${fmtPct(s.cet1_before_pct)} before, ${fmtPct(s.cet1_after_pct)} after (approximate); equity / assets ${fmtPct(s.equity_assets_before_pct)} before, ${fmtPct(s.equity_assets_after_pct)} after`,
    '- Assumes AOCI is excluded from regulatory capital; RWA held constant; no new borrowing, taxes or management actions.',
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
  if (Array.isArray(state.manifest.thresholds) && state.manifest.thresholds.length) {
    THRESHOLDS = Object.fromEntries(state.manifest.thresholds.map((t) => [t.metric, [t.direction, t.value, t.kind]]));
  }
  if (state.manifest.warnings?.length) console.warn('BankScope build warnings:', state.manifest.warnings);
  renderSelect(); renderStats(); renderTicker(); renderMap(); renderTable(); renderCases();
  if (!realBanks().length) setText('hero-copy', 'This build could not reach the FDIC, so only the fictional demo bank is available. Re-run the Publish BankScope workflow to load real institutions.');
  await route();
})();
