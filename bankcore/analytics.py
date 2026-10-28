"""Deterministic finance engine. FDIC balance-sheet amounts are USD thousands.

The stress scenario here is mirrored line for line by site/scenario.js (the browser version);
tests/test_parity.py runs both on the same inputs and requires identical results.
"""
from __future__ import annotations
from typing import Any

FIELDS = [
    "CERT", "REPDTE", "NAME", "ASSET", "DEP", "EQ", "LNLSGR", "CHBAL",
    "DEPUNA", "DEPDOM", "DEPFOR", "NCLNLSR", "RBCRWAJ", "ROA", "ROE", "NIMY",
    # Securities: available-for-sale at fair value / amortized cost; held-to-maturity at
    # amortized cost / fair value. HTM losses are not recognized in equity.
    "SCAF", "SCAA", "SCHA", "SCHF",
    # Regulatory capital (Prompt Corrective Action basis).
    "IDT1CER", "RBC1AAJ", "RWAJ", "RBCT1J",
]

# Prompt Corrective Action "well capitalized" minimums (12 CFR 324.403(b)(1)) used as
# regulatory benchmarks; everything else is an educational heuristic chosen for this project.
WATCH_THRESHOLDS = [
    ("tier1_leverage_pct", "below", 5.0, "Tier 1 leverage ratio below 5%", "regulatory"),
    ("cet1_pct", "below", 6.5, "CET1 capital ratio below 6.5%", "regulatory"),
    ("risk_based_capital_pct", "below", 10.0, "Total risk-based capital ratio below 10%", "regulatory"),
    ("liquid_coverage_pct", "below", 35.0, "Cash and AFS securities cover less than 35% of uninsured and foreign deposits", "heuristic"),
    ("htm_loss_equity_pct", "above", 25.0, "Unrealized losses on held-to-maturity securities above 25% of equity", "heuristic"),
    ("noncurrent_loans_pct", "above", 2.0, "Noncurrent loans above 2% of gross loans", "heuristic"),
    ("loans_deposits_pct", "above", 95.0, "Loans above 95% of deposits", "heuristic"),
]

SCENARIO_DEFAULTS = {
    "deposit_runoff_pct": 25.0,
    "credit_loss_pct": 2.0,
    "securities_haircut_pct": 5.0,
    "include_foreign": True,
    "allow_htm_sales": True,
}


def num(value: Any) -> float | None:
    if value in (None, "", "NA", "N/A"):
        return None
    try:
        result = float(value)
        return result if result == result and result not in (float("inf"), float("-inf")) else None
    except (ValueError, TypeError):
        return None


def ratio(numerator, denominator, *, percent=True):
    n, d = num(numerator), num(denominator)
    if n is None or d is None or d == 0:
        return None
    return (n / d) * (100 if percent else 1)


def date_string(raw):
    s = str(raw or "")
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s


def parse_fdic_record(record: dict) -> dict:
    """Missing fields remain null, rather than silently inventing data."""
    return {
        "date": date_string(record.get("REPDTE")),
        "assets": num(record.get("ASSET")),
        "deposits": num(record.get("DEP")),
        "equity": num(record.get("EQ")),
        "loans": num(record.get("LNLSGR")),
        "cash": num(record.get("CHBAL")),
        "uninsured_deposits": num(record.get("DEPUNA")),
        "domestic_deposits": num(record.get("DEPDOM")),
        "foreign_deposits": num(record.get("DEPFOR")),
        "afs_fair": num(record.get("SCAF")),
        "afs_cost": num(record.get("SCAA")),
        "htm_cost": num(record.get("SCHA")),
        "htm_fair": num(record.get("SCHF")),
        "noncurrent_loans_pct": num(record.get("NCLNLSR")),
        "risk_based_capital_pct": num(record.get("RBCRWAJ")),
        "cet1_pct": num(record.get("IDT1CER")),
        "tier1_leverage_pct": num(record.get("RBC1AAJ")),
        "rwa": num(record.get("RWAJ")),
        "tier1_capital": num(record.get("RBCT1J")),
        "roa_pct": num(record.get("ROA")),
        "roe_pct": num(record.get("ROE")),
        "nim_pct": num(record.get("NIMY")),
    }


def foreign_deposits(rec: dict) -> float:
    """Foreign-office deposits; derived from total minus domestic when the field is absent."""
    f = num(rec.get("foreign_deposits"))
    if f is not None:
        return max(0.0, f)
    dep, dom = num(rec.get("deposits")), num(rec.get("domestic_deposits"))
    return max(0.0, dep - dom) if dep is not None and dom is not None else 0.0


def unrealized_loss(cost, fair) -> float | None:
    """Amortized cost minus fair value (positive means a loss). None if either is missing."""
    c, f = num(cost), num(fair)
    return None if c is None or f is None else c - f


def calculate_metrics(rec: dict) -> dict:
    uninsured = num(rec.get("uninsured_deposits"))
    runnable = None if uninsured is None else uninsured + foreign_deposits(rec)
    cash, afs = num(rec.get("cash")), num(rec.get("afs_fair"))
    liquid = None if cash is None else cash + (afs or 0.0)
    htm_loss = unrealized_loss(rec.get("htm_cost"), rec.get("htm_fair"))
    return {
        "equity_assets_pct": ratio(rec.get("equity"), rec.get("assets")),
        "loans_deposits_pct": ratio(rec.get("loans"), rec.get("deposits")),
        "cash_deposits_pct": ratio(rec.get("cash"), rec.get("deposits")),
        "uninsured_domestic_pct": ratio(uninsured, rec.get("domestic_deposits")),
        "runnable_deposits": runnable,
        "liquid_assets": liquid,
        "liquid_coverage_pct": ratio(liquid, runnable),
        "htm_unrealized_loss": htm_loss,
        "afs_unrealized_loss": unrealized_loss(rec.get("afs_cost"), rec.get("afs_fair")),
        "htm_loss_equity_pct": ratio(htm_loss, rec.get("equity")),
        "noncurrent_loans_pct": num(rec.get("noncurrent_loans_pct")),
        "risk_based_capital_pct": num(rec.get("risk_based_capital_pct")),
        "cet1_pct": num(rec.get("cet1_pct")),
        "tier1_leverage_pct": num(rec.get("tier1_leverage_pct")),
        "roa_pct": num(rec.get("roa_pct")),
        "roe_pct": num(rec.get("roe_pct")),
        "nim_pct": num(rec.get("nim_pct")),
    }


def monitor_signals(metrics: dict) -> list[dict]:
    result = []
    for key, direction, threshold, description, kind in WATCH_THRESHOLDS:
        value = metrics.get(key)
        if value is None:
            continue
        flag = value < threshold if direction == "below" else value > threshold
        result.append({"metric": key, "label": description, "value": round(value, 2), "threshold": threshold,
                       "direction": direction, "kind": kind, "flag": flag})
    return result


def _sell(need: float, available: float, haircut: float) -> tuple[float, float]:
    """Sell just enough of a security tier (at fair value) to raise `need` after the haircut.
    Returns (market value sold, cash raised)."""
    if need <= 0 or available <= 0:
        return 0.0, 0.0
    rate = 1.0 - haircut
    sold = min(available, need / rate) if rate > 0 else available
    return sold, sold * rate


def stress_test(rec: dict, deposit_runoff_pct: float = 25, credit_loss_pct: float = 2,
                securities_haircut_pct: float = 5, include_foreign: bool = True, allow_htm_sales: bool = True):
    """Instantaneous, hypothetical shock to one quarter's balance sheet. Not a supervisory test.

    Liquidity: a share of runnable deposits (estimated uninsured domestic deposits, plus all
    foreign-office deposits if included) leaves. The bank pays with cash first, then sells AFS
    securities, then HTM securities if allowed, each at fair value less the haircut. Anything left
    is the funding gap that would need borrowing (FHLB, Federal Reserve) not modeled here.

    Losses: credit losses on gross loans; the haircut on every security sold; and, on HTM sales,
    the share of the unrealized loss that selling makes real. AFS unrealized losses are already in
    GAAP equity (through AOCI), so selling AFS changes equity only by the haircut; for regulatory
    capital the model assumes AOCI is excluded (true for most banks outside Categories I and II),
    so the realized AFS loss also reduces CET1 and Tier 1. RWA is held constant.
    Amounts in USD thousands; ratios in percent.
    """
    for v in (deposit_runoff_pct, credit_loss_pct, securities_haircut_pct):
        if not 0 <= v <= 100:
            raise ValueError("Scenario percentages must be between 0 and 100")
    h = securities_haircut_pct / 100
    uninsured, cash = num(rec.get("uninsured_deposits")), num(rec.get("cash"))
    loans, equity, assets = num(rec.get("loans")), num(rec.get("equity")), num(rec.get("assets"))
    afs_fair, htm_fair, htm_cost = num(rec.get("afs_fair")) or 0.0, num(rec.get("htm_fair")), num(rec.get("htm_cost"))
    afs_loss_total = unrealized_loss(rec.get("afs_cost"), rec.get("afs_fair")) or 0.0
    htm_value = htm_fair if htm_fair is not None else (htm_cost or 0.0)
    htm_loss_total = unrealized_loss(htm_cost, htm_fair) or 0.0

    runnable = None if uninsured is None else uninsured + (foreign_deposits(rec) if include_foreign else 0.0)
    outflow = None if runnable is None else runnable * deposit_runoff_pct / 100
    liquidity_ok = outflow is not None and cash is not None
    if liquidity_ok:
        cash_used = min(cash, outflow)
        afs_sold, afs_cash = _sell(outflow - cash_used, afs_fair, h)
        htm_sold, htm_cash = _sell(outflow - cash_used - afs_cash, htm_value, h) if allow_htm_sales else (0.0, 0.0)
        paid = cash_used + afs_cash + htm_cash
        gap = max(0.0, outflow - paid)
        afs_realized = afs_loss_total * (afs_sold / afs_fair) if afs_fair > 0 else 0.0
        htm_realized = htm_loss_total * (htm_sold / htm_value) if htm_value > 0 else 0.0
        haircut_loss = (afs_sold + htm_sold) * h
    else:
        cash_used = afs_sold = afs_cash = htm_sold = htm_cash = paid = gap = None
        afs_realized = htm_realized = haircut_loss = 0.0

    credit = None if loans is None else loans * credit_loss_pct / 100
    equity_loss = None if credit is None else credit + haircut_loss + htm_realized
    capital_loss = None if equity_loss is None else equity_loss + afs_realized
    equity_after = None if equity is None or equity_loss is None else equity - equity_loss
    assets_after = None if assets is None or equity_loss is None else assets - equity_loss - (paid or 0.0)

    cet1_pct, rwa = num(rec.get("cet1_pct")), num(rec.get("rwa"))
    t1, lev = num(rec.get("tier1_capital")), num(rec.get("tier1_leverage_pct"))
    cet1_after = None
    if cet1_pct is not None and rwa and capital_loss is not None:
        cet1_after = (cet1_pct / 100 * rwa - capital_loss) / rwa * 100
    lev_after = None
    if t1 is not None and lev and capital_loss is not None:
        denom = t1 / (lev / 100)  # average assets implied by the reported leverage ratio
        lev_after = ratio(t1 - capital_loss, denom - equity_loss - (paid or 0.0))

    return {
        "deposit_runoff_pct": deposit_runoff_pct,
        "credit_loss_pct": credit_loss_pct,
        "securities_haircut_pct": securities_haircut_pct,
        "include_foreign": include_foreign,
        "allow_htm_sales": allow_htm_sales,
        "runnable_deposits": runnable,
        "assumed_deposit_outflow": outflow,
        "cash_used": cash_used,
        "afs_sold": afs_sold, "afs_proceeds": afs_cash,
        "htm_sold": htm_sold, "htm_proceeds": htm_cash,
        "funding_gap": gap,
        "cash_after_outflow": None if not liquidity_ok else cash - outflow,
        "cash_only_funding_gap": None if not liquidity_ok else max(0.0, outflow - cash),
        "credit_loss": credit,
        "haircut_loss": haircut_loss,
        "realized_htm_loss": htm_realized,
        "realized_afs_loss": afs_realized,
        "equity_after_credit_loss": None if equity is None or credit is None else equity - credit,
        "equity_after": equity_after,
        "equity_assets_before_pct": ratio(equity, assets),
        "equity_assets_after_pct": ratio(equity_after, assets_after),
        "cet1_before_pct": cet1_pct,
        "cet1_after_pct": cet1_after,
        "tier1_leverage_before_pct": lev,
        "tier1_leverage_after_pct": lev_after,
        "assumptions": [
            "Runoff applies to estimated uninsured domestic deposits plus, if selected, all foreign-office deposits.",
            "The bank pays with cash, then sells AFS securities, then HTM securities if allowed, each at fair value less the haircut.",
            "Selling HTM securities makes the matching share of their unrealized loss real; it reduces equity and regulatory capital.",
            "AFS losses are already in GAAP equity; regulatory capital is assumed to exclude them until securities are sold.",
            "Credit losses hit gross loans immediately. Taxes, new borrowing, RWA changes and management actions are not modeled.",
        ],
    }


def build_report(*, name: str, cert: int | None, records: list[dict], source: str):
    if not records:
        raise ValueError("No quarterly records")
    sorted_records = sorted(records, key=lambda row: row["date"])
    latest = sorted_records[-1]
    metrics = calculate_metrics(latest)
    signals = monitor_signals(metrics)
    flagged = [s for s in signals if s["flag"]]
    return {
        "institution": {"name": name, "cert": cert},
        "data_mode": source,
        "as_of": latest["date"],
        "units": "USD thousands for balance sheet items; percentages for ratios",
        "latest": latest,
        "history": sorted_records,
        "metrics": metrics,
        "signals": signals,
        "monitor_count": len(flagged),
        "scenario": stress_test(latest),
        "provenance": {
            "provider": "FDIC BankFind Suite" if source == "live" else "Fabricated demo data",
            "source_url": "https://api.fdic.gov/banks/docs" if source == "live" else None,
            "method": "Deterministic Python financial calculations; missing data displayed as unavailable",
        },
    }


def money(thousands) -> str:
    v = num(thousands)
    if v is None:
        return "not available"
    d, sign = abs(v) * 1000, "-" if v < 0 else ""
    if d >= 1e12:
        return f"{sign}${d / 1e12:.2f}T"
    if d >= 1e9:
        return f"{sign}${d / 1e9:.1f}B"
    return f"{sign}${d / 1e6:.1f}M"


def baseline_memo(report: dict) -> dict:
    """Always available, deterministic. Do not mislabel as AI-generated."""
    m, signals = report["metrics"], report["signals"]

    def pct(k, d=2):
        v = m.get(k)
        return "not available" if v is None else f"{v:.{d}f}%"

    bullets = [
        f"Capital: CET1 {pct('cet1_pct')}, Tier 1 leverage {pct('tier1_leverage_pct')}, total risk-based capital {pct('risk_based_capital_pct')}; equity / assets {pct('equity_assets_pct')}.",
        f"Liquidity: cash and AFS securities of {money(m.get('liquid_assets'))} cover {pct('liquid_coverage_pct', 1)} of {money(m.get('runnable_deposits'))} in uninsured and foreign-office deposits; {pct('uninsured_domestic_pct', 1)} of domestic deposits are uninsured.",
        f"Securities: unrealized losses of {money(m.get('htm_unrealized_loss'))} on held-to-maturity securities ({pct('htm_loss_equity_pct', 1)} of equity) are not recognized in equity; AFS unrealized losses of {money(m.get('afs_unrealized_loss'))} already are.",
        f"Credit: loans equal {pct('loans_deposits_pct', 1)} of deposits; noncurrent loans are {pct('noncurrent_loans_pct')} of gross loans.",
        f"Earnings (annualized year to date): ROA {pct('roa_pct')}, ROE {pct('roe_pct')}, net interest margin {pct('nim_pct')}.",
    ]
    attention = [s["label"] for s in signals if s["flag"]]
    reg = [s for s in signals if s["kind"] == "regulatory"]
    heur = [s for s in signals if s["kind"] == "heuristic"]
    reg_hit, heur_hit = sum(s["flag"] for s in reg), sum(s["flag"] for s in heur)
    return {
        "title": f"Bank risk monitoring brief: {report['institution']['name']}",
        "subtitle": f"As of {report['as_of']} | {'ILLUSTRATIVE / NOT REAL' if report['data_mode'] == 'demo' else 'FDIC quarterly data'}",
        "points": bullets,
        "monitoring_flags": attention,
        "interpretation": (
            f"The bank is below {reg_hit} of {len(reg)} well-capitalized benchmarks and crosses {heur_hit} of {len(heur)} teaching heuristics. "
            "Strong regulatory ratios do not rule out liquidity risk: Silicon Valley Bank reported a 15.3% CET1 ratio at the end of 2022. "
            "These checks are screening aids, not regulatory findings, credit ratings or predictions of failure."
        ),
        "limitations": "Entity is an individual FDIC-insured bank charter, not necessarily its consolidated holding company. FDIC data are quarterly and may lag; validate against official filings.",
        "generation": "rules-based",
    }
