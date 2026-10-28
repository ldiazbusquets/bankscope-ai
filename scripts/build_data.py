#!/usr/bin/env python3
"""Build static FDIC bank reports. No pip dependencies and no credentials required.

Which banks are included:
  * The TOP_N largest FDIC-insured institutions by total assets in the latest reported
    quarter, ranked fresh on every build (so the list never goes stale).
  * A short list of failed banks kept as case studies, each checked against the FDIC
    institutions record before it is published.
If the ranking query fails, the build falls back to FALLBACK_BANKS.

FDIC failures never become fictional 'live' data. The demo bank is explicitly fabricated.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bankcore.analytics import FIELDS, build_report, baseline_memo, parse_fdic_record  # noqa: E402
from bankcore.sample import DEMO_CERT, demo_records  # noqa: E402

OUT = ROOT / 'site' / 'data'
API = 'https://api.fdic.gov/banks'
TOP_N = 50
QUARTERS = 12
# (cert, expected FDIC institution name, failure date). Certificates verified against the
# FDIC institutions endpoint on 2026-10-28; the name check below re-verifies on every build.
CASE_STUDIES = [
    (24735, 'Silicon Valley Bank', '2023-03-10'),
    (57053, 'Signature Bank', '2023-03-12'),
    (59017, 'First Republic Bank', '2023-05-01'),
]
FALLBACK_BANKS = [
    (628, 'JPMorgan Chase Bank, N.A.'),
    (3510, 'Bank of America, N.A.'),
    (3511, 'Wells Fargo Bank, N.A.'),
]
INSTITUTION_FIELDS = ['CERT', 'NAME', 'CITY', 'STALP', 'NAMEHCR', 'REGAGNT', 'ACTIVE', 'ENDEFYMD', 'BKCLASS']
# FDIC charter classes for U.S.-chartered banks and savings institutions. Excludes U.S. branches
# of foreign banks (class NC), which file no equity capital and report capital ratios as 0.
US_CHARTER_CLASSES = {'N', 'SM', 'NM', 'SB', 'SA', 'SI'}
CANDIDATE_EXTRA = 25
SUMMARY_KEYS = [
    'equity_assets_pct', 'risk_based_capital_pct', 'uninsured_domestic_pct', 'cash_deposits_pct',
    'loans_deposits_pct', 'noncurrent_loans_pct', 'roa_pct', 'roe_pct', 'nim_pct',
]
USER_AGENT = 'BankScopeAI-FIN414-Educational-Research/0.3'


def write_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')


def fdic_get(endpoint: str, params: dict, attempts: int = 3) -> dict:
    """GET an FDIC BankFind endpoint with retries. Raises RuntimeError on persistent failure."""
    req = Request(f'{API}/{endpoint}?' + urlencode({**params, 'format': 'json'}),
                  headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    last_error = None
    for attempt in range(attempts):
        try:
            with urlopen(req, timeout=28) as resp:
                payload = json.load(resp)
            if not isinstance(payload.get('data'), list):
                raise ValueError('Unexpected FDIC response shape')
            return payload
        except (HTTPError, URLError, ValueError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < attempts - 1:
                time.sleep(attempt + 1)
    raise RuntimeError(f'FDIC {endpoint} request failed ({type(last_error).__name__}: {last_error})')


def rows(payload: dict) -> list[dict]:
    return [v.get('data', v) for v in payload.get('data', []) if isinstance(v, dict)]


def latest_period() -> str:
    """Most recent REPDTE (YYYYMMDD) with filed financials."""
    found = rows(fdic_get('financials', {'fields': 'REPDTE', 'sort_by': 'REPDTE', 'sort_order': 'DESC', 'limit': '1'}))
    if not found or not str(found[0].get('REPDTE', '')).isdigit():
        raise RuntimeError('Could not determine the latest FDIC reporting period')
    return str(found[0]['REPDTE'])


def top_banks(n: int, repdte: str) -> list[int]:
    found = rows(fdic_get('financials', {'filters': f'REPDTE:{repdte}', 'fields': 'CERT,ASSET',
                                         'sort_by': 'ASSET', 'sort_order': 'DESC', 'limit': str(n)}))
    certs = [int(r['CERT']) for r in found if r.get('CERT') is not None]
    if not certs:
        raise RuntimeError(f'FDIC returned no institutions for {repdte}')
    return certs


def institution_info(certs: list[int]) -> dict[int, dict]:
    """FDIC institutions records (proper-case legal name, location, holding company, regulator)."""
    out: dict[int, dict] = {}
    for i in range(0, len(certs), 40):
        chunk = certs[i:i + 40]
        found = rows(fdic_get('institutions', {'filters': 'CERT:(' + ' OR '.join(map(str, chunk)) + ')',
                                               'fields': ','.join(INSTITUTION_FIELDS), 'limit': str(len(chunk) + 5)}))
        for r in found:
            if r.get('CERT') is not None:
                out[int(r['CERT'])] = r
    return out


def us_date(value) -> str | None:
    """FDIC institutions dates are MM/DD/YYYY; return ISO or None."""
    parts = str(value or '').split('/')
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f'{parts[2]}-{int(parts[0]):02d}-{int(parts[1]):02d}'
    return None


def display_name(name: str) -> str:
    name = ' '.join(str(name).split())  # FDIC names sometimes contain double spaces
    for long, short in ((', National Association', ', N.A.'), (' National Association', ', N.A.')):
        if name.endswith(long):
            return name[: -len(long)] + short
    return name


def download_cert(cert: int):
    data = rows(fdic_get('financials', {
        'filters': f'CERT:{cert}',
        'fields': ','.join(FIELDS),
        'sort_by': 'REPDTE',
        'sort_order': 'DESC',
        'limit': str(QUARTERS),
    }))
    parsed = [parse_fdic_record(r) for r in data if r.get('REPDTE')]
    parsed = [r for r in parsed if r['date']]
    if not parsed:
        raise RuntimeError(f'No dated financial observations for certificate {cert}')
    reported_name = data[0].get('NAME') or f'FDIC charter {cert}'
    return build_report(name=str(reported_name), cert=cert, records=parsed, source='live')


def summarize(report: dict) -> dict:
    m = report['metrics']
    s = {k: (round(m[k], 4) if m.get(k) is not None else None) for k in SUMMARY_KEYS}
    s['assets'] = report['latest'].get('assets')
    s['deposits'] = report['latest'].get('deposits')
    s['watch_count'] = report['monitor_count']
    s['checks'] = len(report['signals'])
    return s


def select_banks(warnings: list[str]) -> tuple[list[dict], dict[int, dict]]:
    """Choose this build's banks. Returns ([{cert, rank|None, case}], institutions info by cert).

    Ranks the TOP_N largest U.S.-chartered banks by total assets in the latest quarter, then
    appends the case studies. Falls back to FALLBACK_BANKS if the ranking query fails.
    """
    case_certs = [c for c, _, _ in CASE_STUDIES]
    try:
        repdte = latest_period()
        candidates = top_banks(TOP_N + CANDIDATE_EXTRA, repdte)
    except Exception as exc:
        warnings.append(f'Asset ranking unavailable ({exc}); using the fallback list of {len(FALLBACK_BANKS)} banks.')
        print('WARNING:', warnings[-1], file=sys.stderr)
        repdte, candidates = None, [c for c, _ in FALLBACK_BANKS]
    try:
        info = institution_info(candidates + [c for c in case_certs if c not in candidates])
    except Exception as exc:
        info = {}
        warnings.append(f'Institution details unavailable ({exc}); names shown as filed and charter types not checked.')
    if repdte and info:
        kept = [c for c in candidates if str(info.get(c, {}).get('BKCLASS', '')).upper() in US_CHARTER_CLASSES]
        skipped = [c for c in candidates[:TOP_N] if c not in kept]
        if skipped:
            print(f'Excluded non-U.S.-chartered institutions from the ranking: {skipped}', flush=True)
    else:
        kept = candidates
    selected = [{'cert': c, 'rank': (i if repdte else None), 'case': None} for i, c in enumerate(kept[:TOP_N], start=1)]
    if repdte:
        print(f'Ranked top {len(selected)} U.S.-chartered institutions by assets for {repdte}', flush=True)
    have = {b['cert'] for b in selected}
    for cert, name, failed_on in CASE_STUDIES:
        if cert not in have:
            selected.append({'cert': cert, 'rank': None, 'case': (name, failed_on)})
    return selected, info


def build(offline=False):
    OUT.mkdir(parents=True, exist_ok=True)
    # Remove obsolete data from prior build, including AI reports tied to old bank snapshots.
    for p in OUT.glob('bank_*.json'):
        p.unlink()
    for p in OUT.glob('ai_*.json'):
        p.unlink()

    demo = build_report(name='Northstar Regional Bank (FICTIONAL)', cert=DEMO_CERT,
                        records=demo_records(), source='demo')
    demo['institution'].update({'display_name': 'Northstar Regional Bank', 'status': 'fictional'})
    write_json(OUT / f'bank_{DEMO_CERT}.json', {'report': demo, 'brief': baseline_memo(demo)})
    (ROOT / 'site' / 'demo-data.js').write_text(
        '/* Entirely fabricated example; offline local preview fallback. */\n'
        'window.BANKSCOPE_DEMO = ' + json.dumps({'report': demo, 'brief': baseline_memo(demo)}, ensure_ascii=False) + ';\n',
        encoding='utf-8')
    manifest = {
        'generated_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': 'FDIC BankFind /financials and /institutions, queried by GitHub Actions',
        'demo_cert': DEMO_CERT,
        'banks': [{'cert': DEMO_CERT, 'name': demo['institution']['name'], 'display_name': 'Northstar Regional Bank',
                   'mode': 'demo', 'status': 'fictional', 'as_of': demo['as_of'], 'summary': summarize(demo)}],
        'warnings': [],
        'build_mode': 'offline_demo' if offline else 'fdic_api',
        'ai_enabled': False,
    }
    if not offline:
        selected, info = select_banks(manifest['warnings'])
        for b in selected:
            cert = b['cert']
            meta = info.get(cert, {})
            if b['case']:
                expected = b['case'][0]
                if meta and str(meta.get('NAME', '')).strip().lower() != expected.lower():
                    manifest['warnings'].append(f'Case study FDIC {cert} skipped: FDIC name "{meta.get("NAME")}" does not match "{expected}".')
                    continue
            try:
                report = download_cert(cert)
            except Exception as exc:
                manifest['warnings'].append(f'FDIC {cert} was not published: {exc}')
                print('WARNING:', manifest['warnings'][-1], file=sys.stderr)
                continue
            inactive_on = us_date(meta.get('ENDEFYMD')) if str(meta.get('ACTIVE')) == '0' else None
            failed_on = b['case'][1] if b['case'] else None
            # A closed charter that is not a listed failure (for example after a merger) is
            # marked inactive, never failed; the FDIC change code is not interpreted here.
            inactive_since = inactive_on if not b['case'] else None
            inst = report['institution']
            inst.update({
                'display_name': display_name(str(meta.get('NAME') or inst['name']).strip()),
                'city': meta.get('CITY') or None,
                'state': meta.get('STALP') or None,
                'holding_company': (meta.get('NAMEHCR') or '').strip() or None,
                'regulator': meta.get('REGAGNT') or None,
                'status': 'failed' if b['case'] else ('inactive' if inactive_on else 'active'),
                'failed_on': failed_on,
                'inactive_since': inactive_since,
                'asset_rank': b['rank'],
            })
            write_json(OUT / f'bank_{cert}.json', {'report': report, 'brief': baseline_memo(report)})
            manifest['banks'].append({
                'cert': cert, 'name': inst['name'], 'display_name': inst['display_name'], 'mode': 'live',
                'status': inst['status'], 'failed_on': failed_on, 'inactive_since': inactive_since, 'asset_rank': b['rank'],
                'city': inst['city'], 'state': inst['state'], 'holding_company': inst['holding_company'],
                'regulator': inst['regulator'], 'as_of': report['as_of'], 'summary': summarize(report),
            })
            print(f'OK FDIC {cert}: {inst["display_name"]} @ {report["as_of"]}', flush=True)
            time.sleep(0.15)  # be polite to the public API
    write_json(OUT / 'manifest.json', manifest)
    print(f'Built {len(manifest["banks"])} bank report(s); {len(manifest["warnings"])} warnings.', flush=True)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true', help='Generate explicitly fictional data only; no network')
    args = parser.parse_args()
    build(offline=args.offline)
