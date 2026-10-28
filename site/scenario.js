/* BankScope stress scenario: line-for-line mirror of bankcore/analytics.py stress_test().
   Loaded by the site (window.BankScopeScenario) and by tests/test_parity.py through Node.
   Amounts in USD thousands; ratios in percent. */
(function (root) {
  'use strict';
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const ratio = (a, b) => { const n = num(a), d = num(b); return n === null || d === null || d === 0 ? null : (n / d) * 100; };
  const unrealizedLoss = (cost, fair) => { const c = num(cost), f = num(fair); return c === null || f === null ? null : c - f; };
  function foreignDeposits(rec) {
    const f = num(rec.foreign_deposits);
    if (f !== null) return Math.max(0, f);
    const dep = num(rec.deposits), dom = num(rec.domestic_deposits);
    return dep !== null && dom !== null ? Math.max(0, dep - dom) : 0;
  }
  function sell(need, available, haircut) {
    if (need <= 0 || available <= 0) return [0, 0];
    const rate = 1 - haircut;
    const sold = rate > 0 ? Math.min(available, need / rate) : available;
    return [sold, sold * rate];
  }
  function stressTest(rec, opts) {
    const o = Object.assign({ deposit_runoff_pct: 25, credit_loss_pct: 2, securities_haircut_pct: 5, include_foreign: true, allow_htm_sales: true }, opts || {});
    for (const v of [o.deposit_runoff_pct, o.credit_loss_pct, o.securities_haircut_pct]) {
      if (!(v >= 0 && v <= 100)) throw new Error('Scenario percentages must be between 0 and 100');
    }
    const h = o.securities_haircut_pct / 100;
    const uninsured = num(rec.uninsured_deposits), cash = num(rec.cash);
    const loans = num(rec.loans), equity = num(rec.equity), assets = num(rec.assets);
    const afsFair = num(rec.afs_fair) || 0, htmFair = num(rec.htm_fair), htmCost = num(rec.htm_cost);
    const afsLossTotal = unrealizedLoss(rec.afs_cost, rec.afs_fair) || 0;
    const htmValue = htmFair !== null ? htmFair : (htmCost || 0);
    const htmLossTotal = unrealizedLoss(htmCost, htmFair) || 0;

    const runnable = uninsured === null ? null : uninsured + (o.include_foreign ? foreignDeposits(rec) : 0);
    const outflow = runnable === null ? null : (runnable * o.deposit_runoff_pct) / 100;
    const liquidityOk = outflow !== null && cash !== null;
    let cashUsed = null, afsSold = null, afsCash = null, htmSold = null, htmCash = null, paid = null, gap = null;
    let afsRealized = 0, htmRealized = 0, haircutLoss = 0;
    if (liquidityOk) {
      cashUsed = Math.min(cash, outflow);
      [afsSold, afsCash] = sell(outflow - cashUsed, afsFair, h);
      [htmSold, htmCash] = o.allow_htm_sales ? sell(outflow - cashUsed - afsCash, htmValue, h) : [0, 0];
      paid = cashUsed + afsCash + htmCash;
      gap = Math.max(0, outflow - paid);
      afsRealized = afsFair > 0 ? afsLossTotal * (afsSold / afsFair) : 0;
      htmRealized = htmValue > 0 ? htmLossTotal * (htmSold / htmValue) : 0;
      haircutLoss = (afsSold + htmSold) * h;
    }
    const credit = loans === null ? null : (loans * o.credit_loss_pct) / 100;
    const equityLoss = credit === null ? null : credit + haircutLoss + htmRealized;
    const capitalLoss = equityLoss === null ? null : equityLoss + afsRealized;
    const equityAfter = equity === null || equityLoss === null ? null : equity - equityLoss;
    const assetsAfter = assets === null || equityLoss === null ? null : assets - equityLoss - (paid || 0);

    const cet1Pct = num(rec.cet1_pct), rwa = num(rec.rwa), t1 = num(rec.tier1_capital), lev = num(rec.tier1_leverage_pct);
    const cet1After = cet1Pct !== null && rwa && capitalLoss !== null ? ((cet1Pct / 100) * rwa - capitalLoss) / rwa * 100 : null;
    let levAfter = null;
    if (t1 !== null && lev && capitalLoss !== null) {
      const denom = t1 / (lev / 100);
      levAfter = ratio(t1 - capitalLoss, denom - equityLoss - (paid || 0));
    }
    return {
      deposit_runoff_pct: o.deposit_runoff_pct, credit_loss_pct: o.credit_loss_pct,
      securities_haircut_pct: o.securities_haircut_pct, include_foreign: o.include_foreign, allow_htm_sales: o.allow_htm_sales,
      runnable_deposits: runnable, assumed_deposit_outflow: outflow, cash_used: cashUsed,
      afs_sold: afsSold, afs_proceeds: afsCash, htm_sold: htmSold, htm_proceeds: htmCash, funding_gap: gap,
      cash_after_outflow: liquidityOk ? cash - outflow : null,
      cash_only_funding_gap: liquidityOk ? Math.max(0, outflow - cash) : null,
      credit_loss: credit, haircut_loss: haircutLoss, realized_htm_loss: htmRealized, realized_afs_loss: afsRealized,
      equity_after_credit_loss: equity === null || credit === null ? null : equity - credit,
      equity_after: equityAfter,
      equity_assets_before_pct: ratio(equity, assets), equity_assets_after_pct: ratio(equityAfter, assetsAfter),
      cet1_before_pct: cet1Pct, cet1_after_pct: cet1After,
      tier1_leverage_before_pct: lev, tier1_leverage_after_pct: levAfter,
    };
  }
  const api = { stressTest, foreignDeposits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BankScopeScenario = api;
})(typeof window !== 'undefined' ? window : globalThis);
