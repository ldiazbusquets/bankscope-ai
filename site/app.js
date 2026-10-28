/* BankScope AI front end. Data is precomputed in Python (bankcore/) by GitHub Actions;
   the browser only formats it and recalculates interactive stress scenarios. */
'use strict';

const $ = (id) => document.getElementById(id);
const DEMO_CERT = 999999;
const VIEWS = ['overview', 'stress', 'research', 'method'];

const state = {
  manifest: { banks: [{ cert: DEMO_CERT, name: 'Northstar Regional Bank (FICTIONAL)', mode: 'demo' }], warnings: [] },
  report: null,
  brief: null,
  aiText: '',
  view: 'overview',
  load: 0,
};

/* ---------- formatting ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
const MINUS = '−';

/** FDIC dollar amounts are reported in USD thousands. */
function fmtMoney(thousands) {
  if (!isNum(thousands)) return 'Not reported';
  const dollars = Number(thousands) * 1000;
  const sign = dollars < 0 ? MINUS : '';
  const a = Math.abs(dollars);
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
function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso || 'Unknown';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function fmtQuarter(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${String(d.getUTCFullYear()).slice(2)}`;
}
function fmtBuildTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
}
const setText = (id, text) => { $(id).textContent = text; };

/* ---------- data ---------- */
async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  try { return await r.json(); } catch { throw new Error(`${path} is not valid JSON`); }
}
/** Readable name: build-supplied display name, else a title-cased FDIC legal name. */
function displayName(inst) {
  if (inst?.display_name) return inst.display_name;
  const small = new Set(['of', 'and', 'the', 'for']);
  return String(inst?.name || 'Unknown institution').toLowerCase().split(/\s+/).map((w, i) => {
    if (w === 'na' || w === 'n.a.') return 'N.A.';
    if (i > 0 && small.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ').replace(/ N\.A\.$/, ', N.A.');
}
const isDemo = () => state.report?.data_mode === 'demo';
const bankListed = (cert) => state.manifest.banks.some((b) => Number(b.cert) === Number(cert));

/* ---------- routing (#bank=628&view=stress) ---------- */
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { bank: Number(p.get('bank')) || null, view: VIEWS.includes(p.get('view')) ? p.get('view') : null };
}
function writeHash() {
  if (!state.report) return;
  const p = new URLSearchParams({ bank: String(state.report.institution.cert), view: state.view });
  history.replaceState(null, '', `#${p}`);
}

/* ---------- tabs ---------- */
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
  if (view === 'overview' && state.report) renderChart();
  writeHash();
}
for (const t of tabs()) t.addEventListener('click', () => showView(t.dataset.view));
$('tablist').addEventListener('keydown', (e) => {
  const list = tabs();
  const i = list.findIndex((t) => t.dataset.view === state.view);
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  showView(list[(next + list.length) % list.length].dataset.view, { focus: true });
});

/* ---------- overview ---------- */
function quarterChange(key) {
  const h = state.report.history;
  if (h.length < 2) return null;
  const cur = h[h.length - 1][key], prev = h[h.length - 2][key];
  if (!isNum(cur) || !isNum(prev) || Number(prev) === 0) return null;
  return (Number(cur) / Number(prev) - 1) * 100;
}
function deltaHTML(pct) {
  if (pct === null) return '<span class="reading-note">No prior quarter</span>';
  const cls = Math.abs(pct) < 0.05 ? 'flat' : pct > 0 ? 'up' : 'down';
  const sign = pct > 0 ? '+' : pct < 0 ? MINUS : '';
  return `<span class="delta ${cls}">${sign}${Math.abs(pct).toFixed(1)}%</span> <span class="reading-note">vs prior quarter</span>`;
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
  $('readings').innerHTML = items.map(([label, val, note]) =>
    `<div class="reading"><div class="reading-label">${esc(label)}</div><div class="reading-value">${esc(val)}</div><div>${note}</div></div>`).join('');
}

function niceStep(max) {
  const raw = max / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
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
  if (items.length < 2) { $('history-chart').innerHTML = '<p class="empty">Not enough reported quarters to draw a trend.</p>'; return; }
  const W = Math.max(300, Math.round($('history-chart').clientWidth || 640)), H = W < 480 ? 230 : 280, L = 48, R = 62, T = 12, B = 30;
  const vw = W - L - R, vh = H - T - B;
  const step = niceStep(Math.max(...items.map((d) => Number(d.assets))));
  const max = Math.ceil(Math.max(...items.map((d) => Number(d.assets))) / step) * step;
  const x = (i) => L + (i / (items.length - 1)) * vw;
  const y = (v) => T + (1 - v / max) * vh;
  const path = (k) => items.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(d[k])).toFixed(1)}`).join(' ');
  let grid = '';
  for (let v = 0; v <= max + 1e-6; v += step) {
    const yy = y(v).toFixed(1);
    grid += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" ${v === 0 ? '' : 'stroke-dasharray="2 4"'}/>`;
    grid += `<text class="axis-text" x="${L - 10}" y="${+yy + 4}" text-anchor="end">${axisMoney(v)}</text>`;
  }
  const skip = W < 480 ? 2 : 1;
  const ticks = items.map((d, i) => (items.length - 1 - i) % skip ? '' : `<text class="axis-text" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(fmtQuarter(d.date))}</text>`).join('');
  const dots = (k, cls) => items.map((d, i) => `<circle class="${cls}" cx="${x(i).toFixed(1)}" cy="${y(Number(d[k])).toFixed(1)}" r="3.5" stroke-width="2"><title>${esc(fmtDate(d.date))}: ${esc(fmtMoney(d[k]))}</title></circle>`).join('');
  const last = items[items.length - 1];
  const endA = y(Number(last.assets)), endD = y(Number(last.deposits));
  const gap = 16, ea = Math.min(endA, endD - gap), ed = Math.max(endD, endA + gap);
  $('history-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total assets and total deposits for the last ${items.length} quarters. Latest: assets ${esc(fmtMoney(last.assets))}, deposits ${esc(fmtMoney(last.deposits))}.">
    <defs><linearGradient id="fillAssets" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa9e6" stop-opacity=".18"/><stop offset="1" stop-color="#5aa9e6" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${path('assets')} L${x(items.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z" fill="url(#fillAssets)"/>
    <path class="series-assets" d="${path('assets')}" fill="none" stroke-width="2.25" stroke-linejoin="round"/>
    <path class="series-deposits" d="${path('deposits')}" fill="none" stroke-width="2.25" stroke-linejoin="round"/>
    ${dots('assets', 'dot-assets')}${dots('deposits', 'dot-deposits')}
    <text class="end-label" x="${W - R + 10}" y="${ea + 4}" fill="#5aa9e6">${esc(fmtMoney(last.assets))}</text>
    <text class="end-label" x="${W - R + 10}" y="${ed + 4}" fill="#8fb7cc">${esc(fmtMoney(last.deposits))}</text>
    ${ticks}</svg>`;
  const h = state.report.history, cur = h[h.length - 1], ago = h.length >= 5 ? h[h.length - 5] : null;
  const yoy = (k) => (ago && isNum(cur[k]) && isNum(ago[k]) && Number(ago[k]) !== 0 ? (Number(cur[k]) / Number(ago[k]) - 1) * 100 : null);
  const chg = (p) => (p === null ? '<span class="muted">n/a</span>' : `<span class="delta ${Math.abs(p) < 0.05 ? 'flat' : p > 0 ? 'up' : 'down'}">${p > 0 ? '+' : p < 0 ? MINUS : ''}${Math.abs(p).toFixed(1)}%</span>`);
  $('yoy-table').innerHTML = `<thead><tr><th scope="col">Balance</th><th scope="col">${esc(fmtQuarter(cur.date))}</th><th scope="col">${ago ? esc(fmtQuarter(ago.date)) : 'Year ago'}</th><th scope="col">Change</th></tr></thead><tbody>${
    [['Total assets', 'assets'], ['Total deposits', 'deposits'], ['Gross loans', 'loans'], ['Equity capital', 'equity'], ['Cash and balances', 'cash']].map(([n, k]) =>
      `<tr><th scope="row">${n}</th><td>${esc(fmtMoney(cur[k]))}</td><td>${ago ? esc(fmtMoney(ago[k])) : 'n/a'}</td><td>${chg(yoy(k))}</td></tr>`).join('')}</tbody>`;
  setText('chart-foot', isDemo()
    ? 'Fictional figures. Axis starts at zero so changes are shown at true scale.'
    : 'Source: FDIC BankFind quarterly financials. Axis starts at zero so changes are shown at true scale.');
}

/* Display scale for each screening gauge (percent). Thresholds come from the Python report. */
const GAUGE = {
  equity_assets_pct: { name: 'Equity / assets', max: 16, unit: 'floor' },
  uninsured_domestic_pct: { name: 'Uninsured share of domestic deposits', max: 100, unit: 'ceiling' },
  cash_deposits_pct: { name: 'Cash / deposits', max: 30, unit: 'floor' },
  loans_deposits_pct: { name: 'Loans / deposits', max: 140, unit: 'ceiling' },
  noncurrent_loans_pct: { name: 'Noncurrent loans', max: 5, unit: 'ceiling' },
};
function renderChecks() {
  const signals = state.report.signals || [];
  const watch = signals.filter((s) => s.flag).length;
  const count = $('check-count');
  count.textContent = signals.length ? `${watch} of ${signals.length} on watch` : 'No data';
  count.classList.toggle('has-watch', watch > 0);
  if (!signals.length) { $('checks').innerHTML = '<p class="empty">None of the screened fields were reported for this quarter.</p>'; return; }
  $('checks').innerHTML = signals.map((s) => {
    const g = GAUGE[s.metric] || { name: s.label, max: Math.max(s.threshold * 2, s.value * 1.2), unit: 'ceiling' };
    const max = Math.max(g.max, s.value * 1.05, s.threshold * 1.1);
    const pos = (v) => Math.min(100, Math.max(0, (v / max) * 100));
    const below = g.unit === 'floor';
    const t = pos(s.threshold);
    const zone = below
      ? `<span class="gauge-zone left" style="width:${t}%"></span>`
      : `<span class="gauge-zone right" style="width:${100 - t}%"></span>`;
    const margin = Math.abs(s.value - s.threshold);
    const rel = below
      ? (s.flag ? `${margin.toFixed(2)} pts below the ${s.threshold}% floor` : `${margin.toFixed(2)} pts above the ${s.threshold}% floor`)
      : (s.flag ? `${margin.toFixed(2)} pts above the ${s.threshold}% ceiling` : `${margin.toFixed(2)} pts under the ${s.threshold}% ceiling`);
    return `<div class="check ${s.flag ? 'watch' : ''}">
      <div class="check-top"><span class="check-name">${esc(g.name)}</span><span class="check-value">${fmtPct(s.value)}</span></div>
      <div class="gauge" role="img" aria-label="${esc(g.name)} ${fmtPct(s.value)}; ${esc(rel)}">${zone}<span class="gauge-threshold" style="left:calc(${t}% - 1px)"></span><span class="gauge-mark" style="left:${pos(s.value)}%"></span></div>
      <div class="check-meta"><span>${esc(rel)}</span><span class="check-status">${s.flag ? 'Watch' : 'Within range'}</span></div>
    </div>`;
  }).join('');
}

const INDICATORS = [
  ['Capital', [
    ['risk_based_capital_pct', 'Total risk-based capital ratio', 'Prompt Corrective Action measure', 'reported'],
    ['equity_assets_pct', 'Equity / assets', 'Equity capital ÷ total assets', 'derived'],
  ]],
  ['Liquidity and funding', [
    ['cash_deposits_pct', 'Cash / deposits', 'Cash and due from banks ÷ total deposits', 'derived'],
    ['loans_deposits_pct', 'Loans / deposits', 'Gross loans and leases ÷ total deposits', 'derived'],
    ['uninsured_domestic_pct', 'Uninsured domestic deposits', 'Estimated uninsured ÷ domestic deposits', 'derived'],
  ]],
  ['Asset quality', [
    ['noncurrent_loans_pct', 'Noncurrent loans', '90+ days past due or nonaccrual ÷ gross loans', 'reported'],
  ]],
  ['Earnings', [
    ['roa_pct', 'Return on assets', 'Annualized year-to-date net income ÷ average assets', 'reported'],
    ['roe_pct', 'Return on equity', 'Annualized year-to-date net income ÷ average equity', 'reported'],
    ['nim_pct', 'Net interest margin', 'Annualized year-to-date', 'reported'],
  ]],
];
function renderIndicators() {
  const m = state.report.metrics;
  $('indicator-table').innerHTML = INDICATORS.map(([group, rows]) => `<section class="group"><h3>${esc(group)}</h3>${rows.map(([k, name, def, origin]) =>
    `<div class="ind"><span class="ind-name">${esc(name)}</span><span class="ind-value">${fmtPct(m[k])}</span><span class="ind-def">${esc(def)}</span><span class="ind-origin ${origin}">${origin === 'derived' ? 'Derived' : 'FDIC reported'}</span></div>`).join('')}</section>`).join('');
}

/* ---------- stress test ---------- */
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
    assumed_deposit_outflow: outflow,
    cash_after_outflow: remaining,
    cash_only_funding_gap: remaining === null ? null : Math.max(0, -remaining),
    credit_loss: credit,
    equity_after_credit_loss: newEquity,
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
  setText('runoff-label', `${runoff}%`);
  setText('loss-label', `${loss.toFixed(2)}%`);
  for (const el of ['runoff-slider', 'loss-slider']) {
    const s = $(el); s.style.setProperty('--fill', `${((s.value - s.min) / (s.max - s.min)) * 100}%`);
  }
  for (const c of document.querySelectorAll('.preset-group .chip')) {
    c.setAttribute('aria-pressed', String(Number(c.dataset.runoff) === runoff && Number(c.dataset.loss) === loss));
  }
  const l = state.report.latest, s = currentScenario();

  // Liquidity
  if (s.cash_after_outflow === null) {
    $('liquidity-result').innerHTML = '<p class="empty">Cash or uninsured deposits were not reported for this quarter, so the liquidity scenario cannot be calculated.</p>';
  } else {
    const gap = s.cash_only_funding_gap > 0;
    const cover = s.assumed_deposit_outflow > 0 ? (Number(l.cash) / s.assumed_deposit_outflow) * 100 : null;
    const scale = Math.max(Number(l.cash), s.assumed_deposit_outflow);
    $('liquidity-result').innerHTML = `
      <div class="result-head">
        <span class="result-figure ${gap ? 'negative' : ''}">${gap ? esc(fmtMoney(s.cash_only_funding_gap)) : esc(fmtMoney(s.cash_after_outflow))}</span>
        <span class="result-caption">${gap ? 'cash-only gap: outflow exceeds cash on hand' : 'cash remaining after the outflow'}</span>
      </div>
      <div class="bars">${bar('Deposit outflow', s.assumed_deposit_outflow, scale, 'outflow')}${bar('Cash and balances', l.cash, scale, '')}</div>
      <dl class="result-lines">
        <div><dt>Uninsured domestic deposits</dt><dd>${esc(fmtMoney(l.uninsured_deposits))}</dd></div>
        <div><dt>Cash covers outflow</dt><dd>${cover === null ? 'No outflow' : `${cover >= 999 ? '999%+' : `${cover.toFixed(0)}%`}`}</dd></div>
        <div><dt>Cash after outflow</dt><dd>${esc(fmtMoney(s.cash_after_outflow))}</dd></div>
      </dl>`;
  }

  // Capital
  if (s.equity_assets_after_pct === null) {
    $('capital-result').innerHTML = '<p class="empty">Equity, assets or loans were not reported for this quarter, so the capital scenario cannot be calculated.</p>';
  } else {
    const drop = s.equity_assets_before_pct - s.equity_assets_after_pct;
    const scale = Math.max(Number(l.equity), 1);
    $('capital-result').innerHTML = `
      <div class="result-head">
        <span class="result-figure ${s.equity_assets_after_pct < 0 ? 'negative' : ''}">${fmtPct(s.equity_assets_after_pct)}</span>
        <span class="result-caption">equity / assets after the loss, down ${drop.toFixed(2)} pts from ${fmtPct(s.equity_assets_before_pct)}</span>
      </div>
      <div class="bars">${bar('Equity before', l.equity, scale, '')}${bar('Equity after', Math.max(0, s.equity_after_credit_loss), scale, 'after')}</div>
      <dl class="result-lines">
        <div><dt>Gross loans</dt><dd>${esc(fmtMoney(l.loans))}</dd></div>
        <div><dt>Credit loss</dt><dd>${esc(fmtMoney(s.credit_loss))}</dd></div>
        <div><dt>Loss as share of equity</dt><dd>${fmtPct(ratio(s.credit_loss, l.equity), 1)}</dd></div>
      </dl>`;
  }
}
for (const id of ['runoff-slider', 'loss-slider']) $(id).addEventListener('input', renderStress);
for (const c of document.querySelectorAll('.preset-group .chip')) c.addEventListener('click', () => {
  $('runoff-slider').value = c.dataset.runoff;
  $('loss-slider').value = c.dataset.loss;
  renderStress();
});

/* ---------- research ---------- */
function renderBrief() {
  const b = state.brief;
  if (!b) { $('rules-report').innerHTML = '<p class="muted">No brief was published for this bank.</p>'; return; }
  const flags = b.monitoring_flags.length
    ? `<ul>${b.monitoring_flags.map((f) => `<li class="flag-item">${esc(f)}</li>`).join('')}</ul>`
    : '<p>No screening thresholds were crossed among the fields reported this quarter.</p>';
  $('rules-report').innerHTML = `
    <p class="memo-meta">${esc(isDemo() ? 'Fictional data' : 'FDIC quarterly data')}, quarter ended ${esc(fmtDate(state.report.as_of))}</p>
    <h3>Key figures</h3><ul>${b.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    <h3>On watch</h3>${flags}
    <h3>Interpretation</h3><p>${esc(b.interpretation)}</p>
    <h3>Limitations</h3><p>${esc(b.limitations)}</p>`;
}
function setAI(status, html) {
  const tag = $('ai-tag');
  tag.textContent = status;
  tag.classList.toggle('on', status === 'Published');
  $('ai-answer').innerHTML = html;
}
async function renderAI(cert, request) {
  state.aiText = '';
  if (isDemo()) {
    setAI('Not applicable', '<p class="muted">AI notes are generated only for real FDIC institutions. Choose JPMorgan Chase, Bank of America or Wells Fargo to see whether one has been published.</p>');
    return;
  }
  setAI('Checking', '<p class="muted">Looking for a published AI note.</p>');
  try {
    const ai = await getJSON(`./data/ai_${Number(cert)}.json`);
    if (request !== state.load) return;
    if (ai.bank_as_of !== state.report.as_of || !ai.is_ai_generated) throw new Error('stale');
    state.aiText = ai.answer;
    setAI('Published', `<p class="memo-meta">Model ${esc(ai.model)}, generated ${esc(fmtBuildTime(ai.generated_at_utc) || ai.generated_at_utc)}</p><div class="ai-body"></div><p class="panel-foot">Model commentary can be wrong. Check every figure against the Overview tab before relying on it.</p>`);
    $('ai-answer').querySelector('.ai-body').textContent = ai.answer;
  } catch {
    if (request !== state.load) return;
    setAI('Not published', '<p class="muted">No AI note has been published for this bank yet. The evidence brief works without one. To publish notes, add an <code>AI_API_KEY</code> repository secret and run the Publish BankScope workflow.</p>');
  }
}

/* ---------- load a bank ---------- */
function showError(msg) { const e = $('error'); e.textContent = msg || ''; e.hidden = !msg; }
async function loadBank(cert) {
  if (!bankListed(cert)) { showError('That bank is not in the published dataset. Choose one from the Institution menu.'); return; }
  const request = ++state.load;
  showError('');
  $('loading').hidden = false;
  try {
    const data = Number(cert) === DEMO_CERT && window.BANKSCOPE_DEMO ? window.BANKSCOPE_DEMO : await getJSON(`./data/bank_${Number(cert)}.json`);
    if (request !== state.load) return;
    if (!data?.report?.history?.length || !data.brief) throw new Error('the file is missing report or brief data');
    state.report = data.report;
    state.brief = data.brief;
    $('bank-select').value = String(cert);

    const demo = isDemo();
    setText('bank-name', demo ? 'Northstar Regional Bank' : displayName(state.report.institution));
    document.title = `${demo ? 'Northstar Regional Bank (fictional)' : displayName(state.report.institution)} · BankScope AI`;
    setText('fact-cert', demo ? 'None (fictional)' : String(state.report.institution.cert));
    setText('fact-period', fmtDate(state.report.as_of));
    setText('fact-entity', demo ? 'Fictional bank' : 'Insured bank charter');
    setText('fact-source', demo ? 'Invented figures' : 'FDIC BankFind');
    const notice = $('notice');
    notice.hidden = !demo;
    notice.className = 'notice notice-demo';
    notice.innerHTML = '<strong>Fictional data</strong><span>Northstar Regional Bank and its financial statements are invented for demonstration. No real institution is represented.</span>';

    renderReadings(); renderChart(); renderChecks(); renderIndicators();
    $('runoff-slider').value = 25; $('loss-slider').value = 2;
    renderStress(); renderBrief();
    writeHash();
    await renderAI(cert, request);
  } catch (e) {
    if (request === state.load) showError(`Could not open this bank's data (${e.message}). Try another institution, or re-run the Publish BankScope workflow.`);
  } finally {
    if (request === state.load) $('loading').hidden = true;
  }
}
let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.report && state.view === 'overview') renderChart(); }, 150); });
$('bank-select').addEventListener('change', (e) => loadBank(Number(e.target.value)));

/* ---------- export ---------- */
$('export-button').addEventListener('click', () => {
  const r = state.report, b = state.brief;
  if (!r || !b) return;
  const s = currentScenario();
  const lines = [
    `# BankScope AI research brief: ${isDemo() ? 'Northstar Regional Bank (fictional)' : displayName(r.institution)}`, '',
    isDemo() ? '**Fictional data. This is not a real bank.**' : `Source: FDIC BankFind quarterly financials, bank-charter level (FDIC certificate ${r.institution.cert}, legal name ${r.institution.name})`,
    `Quarter ended: ${fmtDate(r.as_of)}`,
    `Dataset built: ${fmtBuildTime(state.manifest.generated_at_utc) || 'unknown'}`,
    '', '## Snapshot',
    `- Total assets: ${fmtMoney(r.latest.assets)}`,
    `- Total deposits: ${fmtMoney(r.latest.deposits)}`,
    `- Equity / assets: ${fmtPct(r.metrics.equity_assets_pct)}`,
    `- Total risk-based capital ratio: ${fmtPct(r.metrics.risk_based_capital_pct)}`,
    `- Noncurrent loans: ${fmtPct(r.metrics.noncurrent_loans_pct)}`,
    '', '## Evidence brief (rules-based)', ...b.points.map((p) => `- ${p}`),
    '', '### On watch', ...(b.monitoring_flags.length ? b.monitoring_flags.map((f) => `- ${f}`) : ['- No screening thresholds crossed']),
    '', b.interpretation,
    '', '## Stress scenario (hypothetical)',
    `- Uninsured deposit runoff: ${$('runoff-slider').value}% (outflow ${fmtMoney(s.assumed_deposit_outflow)})`,
    `- Cash after outflow: ${fmtMoney(s.cash_after_outflow)}; cash-only gap: ${fmtMoney(s.cash_only_funding_gap)}`,
    `- Credit loss on loans: ${Number($('loss-slider').value).toFixed(2)}% (${fmtMoney(s.credit_loss)})`,
    `- Equity / assets: ${fmtPct(s.equity_assets_before_pct)} before, ${fmtPct(s.equity_assets_after_pct)} after`,
    '- Excludes securities, borrowing capacity, foreign-office deposits, taxes, risk-weighted assets and management actions.',
    ...(state.aiText ? ['', '## AI research note (model-generated; verify every figure)', state.aiText] : []),
    '', '## Limitations', b.limitations,
    '', '---', 'BankScope AI, FIN 414 class project at Bryant University. Not investment, legal or regulatory advice.',
    'FDIC API documentation: https://api.fdic.gov/banks/docs',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `bankscope_${r.institution.cert}_${r.as_of}.md` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- start ---------- */
function renderStatus() {
  const m = state.manifest;
  const live = m.banks.filter((b) => b.mode === 'live').length;
  const built = fmtBuildTime(m.generated_at_utc);
  $('status-dot').className = `status-dot ${live ? 'live' : 'demo'}`;
  setText('status-text', live ? `FDIC data for ${live} ${live === 1 ? 'bank' : 'banks'}` : 'Demo data only');
  setText('status-built', built ? `Built ${built}` : '');
  setText('build-meta', `Last build: ${built || 'unknown'}. Data mode: ${m.build_mode === 'fdic_api' ? 'live FDIC API' : 'offline demo'}. AI notes: ${m.ai_enabled ? 'published' : 'not configured'}.`);
  const sel = $('bank-select');
  const liveBanks = m.banks.filter((b) => b.mode === 'live');
  const demoBanks = m.banks.filter((b) => b.mode !== 'live');
  sel.innerHTML =
    (liveBanks.length ? `<optgroup label="FDIC-insured banks">${liveBanks.map((b) => `<option value="${Number(b.cert)}">${esc(displayName(b))}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="Demonstration">${demoBanks.map((b) => `<option value="${Number(b.cert)}">Northstar Regional Bank (fictional)</option>`).join('')}</optgroup>`;
}

(async function init() {
  try {
    state.manifest = await getJSON('./data/manifest.json');
    if (state.manifest.warnings?.length) showError(`${state.manifest.warnings.length} bank dataset(s) failed to download in the last build and are not shown. The others are unaffected.`);
  } catch {
    // Opened locally without data, or manifest missing: fall back to the clearly labeled demo.
    state.manifest.generated_at_utc = null;
  }
  renderStatus();
  const { bank, view } = readHash();
  const firstLive = state.manifest.banks.find((b) => b.mode === 'live');
  const start = bank && bankListed(bank) ? bank : firstLive ? Number(firstLive.cert) : DEMO_CERT;
  if (view) state.view = view;
  showView(state.view);
  await loadBank(start);
})();
