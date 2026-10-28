"""Entirely fabricated, educational demo data. NEVER present as actual FDIC data."""

DEMO_CERT = 999999

QUARTERS = [
    # date, assets, deposits, equity, gross loans, cash, uninsured dom. deposits,
    # domestic deposits, noncurrent ratio, risk-based capital, ROA, ROE, net interest margin
    ("2024-09-30", 47800000, 40500000, 4520000, 31200000, 6250000, 12300000, 39300000, 1.35, 13.2, 0.92, 9.55, 3.21),
    ("2024-12-31", 48250000, 41000000, 4600000, 31650000, 6310000, 12450000, 39900000, 1.40, 13.4, 0.95, 9.72, 3.24),
    ("2025-03-31", 48900000, 41300000, 4650000, 31900000, 6220000, 12800000, 40000000, 1.51, 13.5, 0.90, 9.38, 3.18),
    ("2025-06-30", 49350000, 41900000, 4780000, 32600000, 6400000, 12900000, 40600000, 1.49, 13.6, 0.96, 9.85, 3.30),
    ("2025-09-30", 50600000, 42900000, 4860000, 33400000, 6580000, 13100000, 41700000, 1.68, 13.3, 0.88, 9.15, 3.26),
    ("2025-12-31", 51200000, 43500000, 4930000, 33800000, 6460000, 13300000, 42100000, 1.71, 13.1, 0.82, 8.73, 3.20),
    ("2026-03-31", 52300000, 44000000, 5040000, 34800000, 6640000, 13900000, 42900000, 1.88, 12.9, 0.76, 8.23, 3.15),
    ("2026-06-30", 53500000, 45100000, 5180000, 35500000, 6700000, 14200000, 43800000, 2.18, 12.8, 0.78, 8.12, 3.12),
]


def demo_records():
    output = []
    for (date, assets, deposits, equity, loans, cash, uninsured, dom_deposits,
         noncurrent, risk_cap, roa, roe, nim) in QUARTERS:
        output.append({
            "date": date,
            "assets": assets, "deposits": deposits, "equity": equity,
            "loans": loans, "cash": cash, "uninsured_deposits": uninsured,
            "domestic_deposits": dom_deposits,
            "noncurrent_loans_pct": noncurrent,
            "risk_based_capital_pct": risk_cap,
            "roa_pct": roa, "roe_pct": roe, "nim_pct": nim,
        })
    return output
