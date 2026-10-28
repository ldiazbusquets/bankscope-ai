"""Deterministic finance engine. FDIC balance-sheet amounts are USD thousands."""
from __future__ import annotations
from typing import Any

FIELDS = [
    "CERT", "REPDTE", "NAME", "ASSET", "DEP", "EQ", "LNLSGR", "CHBAL",
    "DEPUNA", "DEPDOM", "NCLNLSR", "RBCRWAJ", "ROA", "ROE", "NIMY",
]


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
        "noncurrent_loans_pct": num(record.get("NCLNLSR")),
        "risk_based_capital_pct": num(record.get("RBCRWAJ")),
        "roa_pct": num(record.get("ROA")),
        "roe_pct": num(record.get("ROE")),
        "nim_pct": num(record.get("NIMY")),
    }


def calculate_metrics(rec: dict) -> dict:
    return {
        "equity_assets_pct": ratio(rec.get("equity"), rec.get("assets")),
        "loans_deposits_pct": ratio(rec.get("loans"), rec.get("deposits")),
        "cash_deposits_pct": ratio(rec.get("cash"), rec.get("deposits")),
        "uninsured_domestic_pct": ratio(rec.get("uninsured_deposits"), rec.get("domestic_deposits")),
        "noncurrent_loans_pct": num(rec.get("noncurrent_loans_pct")),
        "risk_based_capital_pct": num(rec.get("risk_based_capital_pct")),
        "roa_pct": num(rec.get("roa_pct")),
        "roe_pct": num(rec.get("roe_pct")),
        "nim_pct": num(rec.get("nim_pct")),
    }


# Educational monitoring thresholds, NOT supervisory classifications.
WATCH_THRESHOLDS = [
    ("equity_assets_pct", "below", 8.0, "Equity / assets below 8%"),
    ("uninsured_domestic_pct", "above", 40.0, "Uninsured share of domestic deposits above 40%"),
    ("cash_deposits_pct", "below", 10.0, "Cash / deposits below 10%"),
    ("loans_deposits_pct", "above", 95.0, "Loans / deposits above 95%"),
    ("noncurrent_loans_pct", "above", 2.0, "Noncurrent loans above 2%"),
]


def monitor_signals(metrics: dict) -> list[dict]:
    result = []
    for key, direction, threshold, description in WATCH_THRESHOLDS:
        value = metrics.get(key)
        if value is None:
            continue
        flag = value < threshold if direction == "below" else value > threshold
        result.append({"metric": key, "label": description, "value": round(value, 2), "threshold": threshold, "flag": flag})
    return result


def stress_test(rec: dict, deposit_runoff_pct: float = 25, credit_loss_pct: float = 2):
    """Illustrative instantaneous shock; excludes funding substitutes, taxes, and RWA changes.

    Deposits/cash/loans/equity in USD thousands. Loss directly reduces assets and equity.
    Runoff applies only to estimated uninsured deposits; cash is the only assumed resource.
    This is *not* a regulatory stress test or insolvency forecast.
    """
    if not (0 <= deposit_runoff_pct <= 100 and 0 <= credit_loss_pct <= 100):
        raise ValueError("Scenario percentages must be between 0 and 100")
    uninsured = num(rec.get("uninsured_deposits"))
    cash = num(rec.get("cash"))
    loans = num(rec.get("loans"))
    equity = num(rec.get("equity"))
    assets = num(rec.get("assets"))
    outflow = uninsured * deposit_runoff_pct / 100 if uninsured is not None else None
    remaining_cash = cash - outflow if cash is not None and outflow is not None else None
    shortfall = max(0, -remaining_cash) if remaining_cash is not None else None
    loss = loans * credit_loss_pct / 100 if loans is not None else None
    stressed_equity = equity - loss if equity is not None and loss is not None else None
    stressed_assets = assets - loss if assets is not None and loss is not None else None
    return {
        "deposit_runoff_pct": deposit_runoff_pct,
        "credit_loss_pct": credit_loss_pct,
        "assumed_deposit_outflow": outflow,
        "cash_after_outflow": remaining_cash,
        "cash_only_funding_gap": shortfall,
        "credit_loss": loss,
        "equity_after_credit_loss": stressed_equity,
        "equity_assets_before_pct": ratio(equity, assets),
        "equity_assets_after_pct": ratio(stressed_equity, stressed_assets),
        "assumptions": [
            "Deposit runoff affects estimated uninsured domestic deposits only.",
            "Cash and balances are the only liquidity resource modeled; securities and borrowing capacity are excluded.",
            "Credit losses are applied to gross loans immediately and reduce assets and equity dollar-for-dollar.",
            "Does not model taxes, insured depositor behavior, risk-weighted assets, funding replacements, or second-order effects.",
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
            "source_url": (
                "https://api.fdic.gov/banks/docs" if source == "live" else None
            ),
            "method": "Deterministic Python financial calculations; missing data displayed as unavailable",
        },
    }


def baseline_memo(report: dict) -> dict:
    """Always available, deterministic. Do not mislabel as AI-generated."""
    metrics = report["metrics"]
    signals = report["signals"]
    def fmt(k):
        v = metrics.get(k)
        return "not available" if v is None else f"{v:.2f}%"
    bullets = [
        f"Equity / assets: {fmt('equity_assets_pct')}; reported total risk-based capital ratio: {fmt('risk_based_capital_pct')}.",
        f"Cash / deposits: {fmt('cash_deposits_pct')}; estimated uninsured domestic deposits: {fmt('uninsured_domestic_pct')} of domestic deposits.",
        f"Loans / deposits: {fmt('loans_deposits_pct')}; noncurrent loans: {fmt('noncurrent_loans_pct')}.",
        f"Profitability: ROA {fmt('roa_pct')}, ROE {fmt('roe_pct')}, net interest margin {fmt('nim_pct')}.",
    ]
    attention = [s["label"] for s in signals if s["flag"]]
    return {
        "title": f"Bank risk monitoring brief — {report['institution']['name']}",
        "subtitle": f"As of {report['as_of']} | {'ILLUSTRATIVE / NOT REAL' if report['data_mode'] == 'demo' else 'FDIC quarterly data'}",
        "points": bullets,
        "monitoring_flags": attention,
        "interpretation": (
            f"{len(attention)} of {len(signals)} available educational monitoring thresholds were triggered. "
            "These flags are screening aids—not regulatory findings, credit ratings, or predictions of failure."
        ),
        "limitations": "Entity is an individual FDIC-insured bank charter, not necessarily its consolidated holding company. FDIC data are quarterly and may lag; validate against official filings.",
        "generation": "rules-based",
    }
