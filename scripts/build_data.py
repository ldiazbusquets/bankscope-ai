#!/usr/bin/env python3
"""Build static FDIC bank reports. No pip dependencies and no credentials required.

FDIC failures never become fictional 'live' data. Demo is explicitly fabricated.
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
BANKS = [
    (628, 'JPMorgan Chase Bank, N.A.'),
    (3510, 'Bank of America, N.A.'),
    (3511, 'Wells Fargo Bank, N.A.'),
]
URL = 'https://api.fdic.gov/banks/financials'


def write_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')


def download_cert(cert: int):
    params = {
        'filters': f'CERT:{cert}',
        'fields': ','.join(FIELDS),
        'sort_by': 'REPDTE',
        'sort_order': 'DESC',
        'limit': '12',
        'format': 'json',
    }
    req = Request(URL + '?' + urlencode(params), headers={
        'User-Agent': 'BankScopeAI-FIN414-Educational-Research/0.2',
        'Accept': 'application/json',
    })
    last_error = None
    for attempt in range(3):
        try:
            with urlopen(req, timeout=28) as resp:
                payload = json.load(resp)
            if not isinstance(payload.get('data'), list):
                raise ValueError('Unexpected FDIC response shape')
            rows = [v.get('data', v) for v in payload['data'] if isinstance(v, dict)]
            parsed = [parse_fdic_record(r) for r in rows if r.get('REPDTE')]
            parsed = [r for r in parsed if r['date']]
            if not parsed:
                raise ValueError('No dated financial observations for certificate')
            reported_name = rows[0].get('NAME') or f'FDIC charter {cert}'
            return build_report(name=str(reported_name), cert=cert, records=parsed, source='live')
        except (HTTPError, URLError, ValueError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(f'FDIC request for CERT {cert} failed ({type(last_error).__name__}: {last_error})')


def build(offline=False):
    OUT.mkdir(parents=True, exist_ok=True)
    # Remove obsolete data from prior build, including AI reports tied to old bank snapshots.
    for p in OUT.glob('bank_*.json'):
        p.unlink()
    for p in OUT.glob('ai_*.json'):
        p.unlink()

    demo = build_report(name='Northstar Regional Bank (FICTIONAL)', cert=DEMO_CERT,
                        records=demo_records(), source='demo')
    write_json(OUT / f'bank_{DEMO_CERT}.json', {'report': demo, 'brief': baseline_memo(demo)})
    (ROOT / 'site' / 'demo-data.js').write_text(
        '/* Entirely fabricated example; offline local preview fallback. */\n'
        'window.BANKSCOPE_DEMO = ' + json.dumps({'report': demo, 'brief': baseline_memo(demo)}, ensure_ascii=False) + ';\n',
        encoding='utf-8')
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    manifest = {
        'generated_at_utc': now,
        'source': 'FDIC BankFind /financials (quarterly), queried by GitHub Actions',
        'demo_cert': DEMO_CERT,
        'banks': [{'cert': DEMO_CERT, 'name': demo['institution']['name'], 'mode': 'demo',
                   'as_of': demo['as_of']}],
        'warnings': [],
        'build_mode': 'offline_demo' if offline else 'fdic_api',
        'ai_enabled': False,
    }
    if not offline:
        for cert, fallback_name in BANKS:
            try:
                report = download_cert(cert)
                # FDIC returns legal names in upper case; keep it and add a readable display name.
                report['institution']['display_name'] = fallback_name
                write_json(OUT / f'bank_{cert}.json', {'report': report, 'brief': baseline_memo(report)})
                manifest['banks'].append({'cert': cert, 'name': report['institution']['name'],
                                          'display_name': fallback_name,
                                          'mode': 'live', 'as_of': report['as_of']})
                print(f'OK FDIC {cert}: {report["institution"]["name"]} @ {report["as_of"]}', flush=True)
            except Exception as exc:
                warning = f'{fallback_name} (FDIC {cert}) was not published: {exc}'
                print('WARNING:', warning, file=sys.stderr)
                manifest['warnings'].append(warning)
    write_json(OUT / 'manifest.json', manifest)
    print(f'Built {len(manifest["banks"])} bank report(s); {len(manifest["warnings"])} warnings.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true', help='Generate explicitly fictional data only; no network')
    args = parser.parse_args()
    build(offline=args.offline)
