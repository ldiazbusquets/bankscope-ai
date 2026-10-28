/* BankScope GitHub Pages v0.2: Python precomputed bank datasets, JS scenario engine. */
const $ = (id) => document.getElementById(id);
let report = null;
let brief = null;
let aiText = '';
let selectedTab = 'overview';
let manifest = {banks:[{cert:999999,name:'Northstar Regional Bank (FICTIONAL)',mode:'demo'}],warnings:[]};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (x) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const fmtPercent = (n, d=2) => n == null || !Number.isFinite(Number(n)) ? 'N/A' : `${Number(n).toFixed(d)}%`;
const fmtMoney = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A';
  const value = Number(n);
  if (Math.abs(value) >= 1_000_000) return `${value < 0 ? '−' : ''}$${Math.abs(value / 1_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000) return `${value < 0 ? '−' : ''}$${Math.abs(value / 1_000).toFixed(2)}M`;
  return `${value < 0 ? '−' : ''}$${Math.abs(value).toFixed(1)}K`;
};
const value = (id, content) => { $(id).textContent = content; };

async function getJSON(path) {
  const r = await fetch(path, {cache:'no-store'});
  let body;
  try { body = await r.json(); } catch { throw Error(`Invalid JSON response from ${path}`); }
  if (!r.ok) throw Error(`Dataset not available (HTTP ${r.status})`);
  return body;
}
function busy(flag) { $('loading').hidden = !flag; }
function error(message) { const el = $('error'); el.textContent = message || ''; el.hidden = !message; }

function navigate(tab) {
  selectedTab = tab;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${tab}`));
  value('current-route', {overview:'OVERVIEW', stress:'STRESS LAB', research:'RESEARCH AGENT', method:'METHODOLOGY'}[tab] || tab.toUpperCase());
}
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.tab)));

function chartSVG(records) {
  const items = (records || []).slice(-8).filter(r => r.assets != null && r.deposits != null);
  if (!items.length) return '<p style="color:#879bb0">Historical data unavailable</p>';
  const w = 650, h = 295, left = 48, right = 17, top = 20, bottom = 40;
  const vw = w - left - right, vh = h - top - bottom;
  const all = items.flatMap(d => [d.assets, d.deposits]);
  const min = Math.floor(Math.min(...all) / 5_000_000) * 5_000_000;
  const max = Math.ceil(Math.max(...all) / 5_000_000) * 5_000_000;
  const spread = Math.max(1, max - min);
  const x = (i) => left + (items.length === 1 ? vw / 2 : (i / (items.length - 1)) * vw);
  const y = (v) => top + (1 - (v - min) / spread) * vh;
  const line = (key) => items.map((d,i) => `${i?'L':'M'} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
  const area = (key) => `${line(key)} L ${x(items.length - 1).toFixed(1)} ${top + vh} L ${x(0).toFixed(1)} ${top + vh} Z`;
  const grid = Array.from({length:5}, (_,i) => {
    const val = min + spread * i/4;
    const yy = y(val).toFixed(1);
    return `<line x1="${left}" y1="${yy}" x2="${w-right}" y2="${yy}" stroke="#27394d" stroke-dasharray="3 5"/><text x="${left-10}" y="${Number(yy)+3}" text-anchor="end" fill="#69829c" font-size="11">${(val/1e6).toFixed(0)}B</text>`;
  }).join('');
  const tick = items.map((r,i) => {
    const d = new Date(r.date + 'T00:00:00Z');
    const date = Number.isNaN(d.getTime()) ? r.date : `Q${Math.floor(d.getUTCMonth()/3)+1} '${String(d.getUTCFullYear()).slice(2)}`;
    return `<text x="${x(i)}" y="${h-12}" text-anchor="middle" font-size="11" fill="#7f95ab">${escapeHtml(date)}</text>`;
  }).join('');
  const dots = (key,color) => items.map((row,i) => `<circle cx="${x(i)}" cy="${y(row[key])}" r="3.6" fill="${color}" stroke="#0e1928" stroke-width="2"><title>${escapeHtml(row.date)}: ${fmtMoney(row[key])}</title></circle>`).join('');
  return `<svg role="img" aria-label="Last ${items.length} quarters of assets and deposits, in billions of dollars" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="assetShade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#478fc7" stop-opacity=".23"/><stop offset="1" stop-color="#478fc7" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area('assets')}" fill="url(#assetShade)"/><path d="${line('assets')}" fill="none" stroke="#76b9f0" stroke-width="2.8" stroke-linejoin="round"/><path d="${line('deposits')}" fill="none" stroke="#6dacae" stroke-width="2.4" stroke-linejoin="round"/>${dots('assets','#76b9f0')}${dots('deposits','#6dacae')}${tick}</svg>`;
}

const indicators = [
 ['risk_based_capital_pct','Total risk-based capital ratio','FDIC-reported ratio (not derived)'],
 ['loans_deposits_pct','Loans / deposits','Gross loans ÷ total deposits'],
 ['cash_deposits_pct','Cash / deposits','Cash and balances ÷ total deposits'],
 ['uninsured_domestic_pct','Uninsured domestic deposits','Estimated uninsured ÷ domestic deposits'],
 ['roa_pct','Return on assets','FDIC-reported annualized ratio'],
 ['roe_pct','Return on equity','FDIC-reported annualized ratio'],
 ['nim_pct','Net interest margin','FDIC-reported annualized ratio'],
 ['noncurrent_loans_pct','Noncurrent loans','FDIC-reported loan delinquency measure'],
 ['equity_assets_pct','Equity / assets','Accounting equity ÷ total assets'],
];

function renderOverview() {
  const l = report.latest, m = report.metrics;
  value('kpi-assets', fmtMoney(l.assets));
  value('kpi-deposits', fmtMoney(l.deposits));
  value('kpi-capital', fmtPercent(m.equity_assets_pct));
  value('kpi-npl', fmtPercent(m.noncurrent_loans_pct));
  $('history-chart').innerHTML = chartSVG(report.history);
  value('chart-source', report.data_mode === 'demo' ? 'FABRICATED DEMO DATA' : 'FDIC BANKFIND SUITE · QUARTERLY DATA');
  const flagged = report.signals.filter(s => s.flag).length;
  value('watch-count', `${flagged} / ${report.signals.length} FLAGS`);
  $('signal-list').innerHTML = report.signals.length ? report.signals.map(s => `<div class="signal ${s.flag?'flag':''}"><span class="signal-icon">${s.flag?'!':'✓'}</span><span class="signal-name">${escapeHtml(s.label)}</span><span class="signal-tag">${s.flag?'WATCH':'PASS'}</span></div>`).join('') : '<p class="panel-explainer">No available monitoring metrics.</p>';
  $('ratio-grid').innerHTML = indicators.map(([key,label,detail]) => `<div class="ratio"><div class="ratio-label">${escapeHtml(label)}</div><div class="ratio-value">${fmtPercent(m[key])}</div><div class="ratio-detail">${escapeHtml(detail)}</div></div>`).join('');
}
function renderStress(s) {
  const items = [
    ['ASSUMED DEPOSIT OUTFLOW',fmtMoney(s.assumed_deposit_outflow),'Uninsured domestic deposit shock'],
    ['CASH AFTER OUTFLOW',fmtMoney(s.cash_after_outflow),'Cash-only model; excludes securities'],
    ['CASH-ONLY FUNDING GAP',fmtMoney(s.cash_only_funding_gap),'Not a total liquidity shortfall'],
    ['MODELED CREDIT LOSS',fmtMoney(s.credit_loss),'Gross loans × assumed loss rate'],
    ['EQUITY / ASSETS · BEFORE',fmtPercent(s.equity_assets_before_pct),'Accounting ratio'],
    ['EQUITY / ASSETS · AFTER',fmtPercent(s.equity_assets_after_pct),'Simplified post-loss ratio'],
  ];
  $('stress-results').innerHTML = items.map(([label,val,help],i) => `<div class="stress-stat"><small>${escapeHtml(label)}</small><strong class="${(i===1&&s.cash_after_outflow<0)||(i===5&&s.equity_assets_after_pct<0)?'negative':''}">${escapeHtml(val)}</strong><em>${escapeHtml(help)}</em></div>`).join('');
}
function renderBrief(b) {
  if (!b) return;
  const flags = b.monitoring_flags.length
    ? `<ul>${b.monitoring_flags.map(s => `<li class="flag-list">${escapeHtml(s)}</li>`).join('')}</ul>`
    : '<p>No educational thresholds triggered among available fields.</p>';
  $('rules-report').innerHTML = `<p class="report-subtitle">${escapeHtml(b.subtitle)}</p><ul>${b.points.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul><h4>Monitoring flags</h4>${flags}<h4>Research interpretation</h4><p>${escapeHtml(b.interpretation)}</p><h4>Limitations</h4><p>${escapeHtml(b.limitations)}</p>`;
}


const ratio = (a,b) => Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a / b) * 100 : null;
function scenario(rec, runoff, lossPct) {
  // Mirror bankcore/analytics.py::stress_test. FDIC balance sheet units: USD thousands.
  const num = v => v === null || v === undefined || v === '' ? null : Number(v);
  const u = num(rec.uninsured_deposits), cash = num(rec.cash), loans = num(rec.loans);
  const equity = num(rec.equity), assets = num(rec.assets);
  const outflow = u === null ? null : u * runoff / 100;
  const remaining = cash === null || outflow === null ? null : cash - outflow;
  const credit = loans === null ? null : loans * lossPct / 100;
  const newEquity = equity === null || credit === null ? null : equity - credit;
  const newAssets = assets === null || credit === null ? null : assets - credit;
  return {
    assumed_deposit_outflow: outflow,
    cash_after_outflow: remaining,
    cash_only_funding_gap: remaining === null ? null : Math.max(0,-remaining),
    credit_loss: credit,
    equity_assets_before_pct: equity === null || assets === null ? null : ratio(equity,assets),
    equity_assets_after_pct: newEquity === null || newAssets === null ? null : ratio(newEquity,newAssets)
  };
}
let currentLoad = 0;
async function loadBank(cert) {
  if (!manifest.banks.some(b=>Number(b.cert)===Number(cert))) {
    return error('That bank is not in this published dataset. Try a listed bank or the demo.');
  }
  const request = ++currentLoad;
  error(''); busy(true); $('search-results').hidden = true;
  try {
    let data;
    if (Number(cert)===999999 && window.BANKSCOPE_DEMO) data = window.BANKSCOPE_DEMO;
    else data = await getJSON(`./data/bank_${Number(cert)}.json`);
    if (request !== currentLoad) return;
    if (!data || !data.report || !data.brief) throw Error('Malformed bank data');
    report = data.report;
    brief = data.brief;
    aiText = '';
    value('bank-name', report.institution.name);
    value('period-label', `REPORTING · ${report.as_of}`);
    value('cert-label', `FDIC CERT · ${report.institution.cert}${report.data_mode==='demo'?' (FICTIONAL)':''}`);
    const demo = report.data_mode==='demo';
    $('data-badge').textContent = demo ? 'ILLUSTRATIVE' : 'FDIC QUARTERLY SOURCE';
    $('data-badge').className = `data-badge ${demo?'demo':''}`;
    $('notice').className = `notice ${demo?'demo-notice':'live-notice'}`;
    $('notice').innerHTML = demo
      ? '<strong>ILLUSTRATIVE DATA</strong><span>Fictional bank and invented financials. No real institution is represented.</span>'
      : `<strong>PUBLIC FDIC DATA</strong><span>Quarter ended ${escapeHtml(report.as_of)}. Compiled at build time; not a live API response or an official risk rating.</span>`;
    renderOverview(); renderBrief(brief);
    $('runoff-slider').value = 25;
    $('loss-slider').value = 2;
    stressUpdated();
    $('ai-answer').innerHTML = '<span class="tiny-heading">AI RESEARCH</span><p>Checking for a pre-generated AI report…</p>';
    if (demo) {
      $('ai-answer').innerHTML = '<span class="tiny-heading">DEMO MODE</span><p>No AI-generated assessment for fictional demo data. Select a published real bank and enable AI in the GitHub workflow.</p>';
    } else {
      try {
        const ai = await getJSON(`./data/ai_${Number(cert)}.json`);
        if (request !== currentLoad) return;
        if (ai.bank_as_of!==report.as_of || !ai.is_ai_generated) throw Error('AI output did not match current evidence');
        aiText = ai.answer;
        $('ai-answer').innerHTML = `<span class="tiny-heading">AI-GENERATED · ${escapeHtml(ai.model)} · ${escapeHtml(ai.generated_at_utc)}</span><pre></pre><p class="tiny-caveat">AI commentary is not independently verified. Cross-check the FDIC-sourced metrics.</p>`;
        $('ai-answer').querySelector('pre').textContent = ai.answer;
      } catch {
        if (request !== currentLoad) return;
        $('ai-answer').innerHTML = '<span class="tiny-heading">AI NOT YET ENABLED</span><p>No model-generated commentary was published for this bank. The deterministic brief at left is fully functional. To add AI, configure the GitHub secret and rerun Publish BankScope.</p>';
      }
    }
  } catch(e) {
    if (request===currentLoad) error(`Unable to open bank data: ${e.message}. Select the fictional demo or rerun the workflow.`);
  } finally {
    if (request===currentLoad) busy(false);
  }
}
function stressUpdated() {
  if (!report) return;
  const runoff = Number($('runoff-slider').value), loss = Number($('loss-slider').value);
  value('runoff-label', `${runoff}%`); value('loss-label', `${loss.toFixed(2)}%`);
  document.querySelectorAll('.scenario-presets button').forEach(b => b.classList.toggle('active', Number(b.dataset.runoff)===runoff && Number(b.dataset.loss)===loss));
  renderStress(scenario(report.latest,runoff,loss));
  value('scenario-status','BROWSER CALCULATION');
}
for (const id of ['runoff-slider','loss-slider']) $(id).addEventListener('input', stressUpdated);
document.querySelectorAll('.scenario-presets button').forEach(b => b.addEventListener('click', () => {
  $('runoff-slider').value=b.dataset.runoff;
  $('loss-slider').value=b.dataset.loss;
  stressUpdated();
}));
document.querySelectorAll('.preset').forEach(btn => btn.addEventListener('click', () => loadBank(Number(btn.dataset.cert))));
$('search-form').addEventListener('submit', (ev) => {
  ev.preventDefault();error('');
  const q = $('bank-query').value.trim().toLowerCase();
  if (!q) return error('Enter a bank name or FDIC certificate.');
  const matches = manifest.banks.filter(b=>b.name.toLowerCase().includes(q) || String(b.cert)===q);
  const results = $('search-results');
  if (!matches.length) results.innerHTML = '<p>No matches in the current published bank list. This is not an unrestricted FDIC search.</p>';
  else results.innerHTML = matches.map(b=>`<button type="button" data-id="${Number(b.cert)}"><span>${escapeHtml(b.name)}</span><small>${b.mode==='demo'?'FICTIONAL DEMO':`FDIC ${Number(b.cert)} · ${escapeHtml(b.as_of || '')}`}</small></button>`).join('');
  results.hidden = false;
  results.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>loadBank(Number(btn.dataset.id))));
});
$('export-button').addEventListener('click',()=>{
  if (!report || !brief) return;
  const lines = [
    `# BankScope AI — ${report.institution.name}`, '',
    report.data_mode==='demo'?'**FICTIONAL DATA — NOT A REAL BANK**':'Source: FDIC BankFind Suite, bank-charter-level quarterly financial data',
    `Reported period: ${report.as_of}`,
    `Certificate: ${report.institution.cert}`,
    '', '## Financial snapshot',
    `- Total assets: ${fmtMoney(report.latest.assets)}`,
    `- Total deposits: ${fmtMoney(report.latest.deposits)}`,
    `- Equity / assets: ${fmtPercent(report.metrics.equity_assets_pct)}`,
    `- Noncurrent loans: ${fmtPercent(report.metrics.noncurrent_loans_pct)}`,
    '', '## Deterministic evidence brief', ...brief.points.map(s=>`- ${s}`),
    '', '## Monitoring flags', ...(brief.monitoring_flags.length?brief.monitoring_flags.map(s=>`- ${s}`):['- None of the available rule thresholds triggered']),
    '', brief.interpretation, '', '## Limitations', brief.limitations,
    '', '## Current hypothetical stress scenario',
    `- Uninsured deposit runoff: ${$('runoff-slider').value}%`,
    `- Gross loan credit loss: ${$('loss-slider').value}%`,
    `- Cash-only funding gap: ${fmtMoney(scenario(report.latest,+$('runoff-slider').value,+$('loss-slider').value).cash_only_funding_gap)}`,
    '', ...(aiText ? ['## Optional AI-generated research note', aiText, 'Model output may contain errors. Verify all statements.'] : []),
    '', 'FDIC reference: https://api.fdic.gov/banks/docs',
    'Class project only; not regulatory advice, an official rating, or investment guidance.'
  ];
  const blob = new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href=url;a.download=`bankscope_${report.institution.cert}_${report.as_of}.md`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
(async function initialize(){
  // Fail over to the transparently fictional demo when opening locally or if
  // the generated manifest is not available. Never treat demo as real.
  try { manifest = await getJSON('./data/manifest.json');
    const live = manifest.banks.filter(b=>b.mode==='live').length;
    value('api-state',live?`${live} FDIC BANKS PUBLISHED`:'DEMO-ONLY BUILD');
    value('model-state',manifest.ai_enabled?'MODEL STATUS: PREGENERATED AI REPORTS':'MODEL STATUS: NOT CONFIGURED');
    if (manifest.warnings.length) error(`${manifest.warnings.length} FDIC dataset(s) were unavailable during the last build. See GitHub Actions logs. Other banks and the demo remain usable.`);
  } catch {
    value('api-state','OFFLINE DEMO AVAILABLE');
    value('model-state','MODEL STATUS: NOT CONFIGURED');
  }
  document.querySelectorAll('.preset:not(.demo-preset)').forEach(b=>{b.disabled=!manifest.banks.some(k=>Number(k.cert)===Number(b.dataset.cert));b.title=b.disabled?'FDIC data for this bank was not published by the workflow':'';});
  await loadBank(999999);
})();
