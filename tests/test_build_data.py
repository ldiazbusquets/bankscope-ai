"""Offline tests for scripts/build_data.py. The FDIC API is replaced with a fake that returns
responses shaped like real BankFind output (captured 2026-10-28); no network is used."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('build_data', ROOT / 'scripts' / 'build_data.py')
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)


def fin_row(cert, name, date, assets):
    return {'data': {'CERT': cert, 'NAME': name, 'REPDTE': date, 'ASSET': assets, 'DEP': assets * 0.7,
                     'EQ': assets * 0.09, 'LNLSGR': assets * 0.5, 'CHBAL': assets * 0.08,
                     'DEPUNA': assets * 0.3, 'DEPDOM': assets * 0.6, 'NCLNLSR': 0.8, 'RBCRWAJ': 14.1,
                     'ROA': 1.1, 'ROE': 11.2, 'NIMY': 3.0}}


INSTITUTIONS = {
    628: {'CERT': 628, 'NAME': 'JPMorgan Chase Bank, National Association', 'CITY': 'Columbus', 'STALP': 'OH',
          'NAMEHCR': 'JPMORGAN CHASE&CO', 'REGAGNT': 'OCC', 'ACTIVE': 1, 'ENDEFYMD': '12/31/9999', 'BKCLASS': 'N'},
    14: {'CERT': 14, 'NAME': 'State Street Bank and Trust Company', 'CITY': 'Boston', 'STALP': 'MA',
         'NAMEHCR': 'STATE STREET CORP', 'REGAGNT': 'FED', 'ACTIVE': 1, 'ENDEFYMD': '12/31/9999', 'BKCLASS': 'SM'},
    777: {'CERT': 777, 'NAME': 'Broken  Download Bank', 'BKCLASS': 'NM', 'ACTIVE': 1},
    33692: {'CERT': 33692, 'NAME': 'STANDARD CHARTERED BANK, PLC', 'CITY': 'New York', 'STALP': 'NY', 'BKCLASS': 'NC', 'ACTIVE': 1},
    24735: {'CERT': 24735, 'NAME': 'Silicon Valley Bank', 'CITY': 'Santa Clara', 'STALP': 'CA',
            'NAMEHCR': 'SVB FINANCIAL GROUP', 'REGAGNT': 'FED', 'ACTIVE': 0, 'ENDEFYMD': '03/10/2023'},
    57053: {'CERT': 57053, 'NAME': 'Signature Bank', 'CITY': 'New York', 'STALP': 'NY', 'NAMEHCR': '',
            'REGAGNT': 'FDIC', 'ACTIVE': 0, 'ENDEFYMD': '03/12/2023'},
    # Deliberately wrong name to prove the case-study identity check works.
    59017: {'CERT': 59017, 'NAME': 'Some Other Bank', 'CITY': 'San Francisco', 'STALP': 'CA', 'NAMEHCR': '',
            'REGAGNT': 'FDIC', 'ACTIVE': 0, 'ENDEFYMD': '05/01/2023'},
}


def fake_fdic(endpoint, params, attempts=3):
    f = params.get('filters', '')
    if endpoint == 'institutions':
        certs = [int(c) for c in f[len('CERT:('):-1].split(' OR ')]
        return {'data': [{'data': INSTITUTIONS[c]} for c in certs if c in INSTITUTIONS]}
    if params.get('fields') == 'REPDTE':
        return {'data': [{'data': {'REPDTE': '20260630'}}]}
    if f.startswith('REPDTE:'):
        return {'data': [{'data': {'CERT': 628, 'ASSET': 4e9}}, {'data': {'CERT': 33692, 'ASSET': 5e8}},
                         {'data': {'CERT': 14, 'ASSET': 4e8}}, {'data': {'CERT': 777, 'ASSET': 1e8}}]}
    cert = int(f.split(':')[1])
    if cert == 777:
        raise RuntimeError('FDIC financials request failed (HTTPError: 500)')
    if cert == 24735:
        return {'data': [fin_row(cert, 'SILICON VALLEY BANK', '20221231', 209026000),
                         fin_row(cert, 'SILICON VALLEY BANK', '20220930', 210244000)]}
    return {'data': [fin_row(cert, 'BANK', '20260630', 1e9), fin_row(cert, 'BANK', '20260331', 9.8e8)]}


class BuildDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / 'site' / 'data').mkdir(parents=True)
        self._saved = (bd.OUT, bd.ROOT, bd.fdic_get, bd.time.sleep)
        bd.OUT, bd.ROOT, bd.fdic_get = root / 'site' / 'data', root, fake_fdic
        bd.time.sleep = lambda s: None
        self.manifest = bd.build(offline=False)
        self.banks = {b['cert']: b for b in self.manifest['banks']}

    def tearDown(self):
        bd.OUT, bd.ROOT, bd.fdic_get, bd.time.sleep = self._saved
        self.tmp.cleanup()

    def test_ranked_banks_published_with_ranks(self):
        self.assertEqual(self.banks[628]['asset_rank'], 1)
        self.assertEqual(self.banks[14]['asset_rank'], 2)
        self.assertEqual(self.banks[628]['status'], 'active')

    def test_display_name_and_metadata_from_institutions(self):
        b = self.banks[628]
        self.assertEqual(b['display_name'], 'JPMorgan Chase Bank, N.A.')
        self.assertEqual((b['city'], b['state'], b['regulator']), ('Columbus', 'OH', 'OCC'))
        self.assertEqual(self.banks[14]['display_name'], 'State Street Bank and Trust Company')

    def test_failed_download_becomes_warning_not_data(self):
        self.assertNotIn(777, self.banks)
        self.assertTrue(any('777' in w for w in self.manifest['warnings']))
        self.assertFalse((bd.OUT / 'bank_777.json').exists())

    def test_case_study_published_as_failed_with_last_quarter(self):
        svb = self.banks[24735]
        self.assertEqual((svb['status'], svb['failed_on'], svb['as_of']), ('failed', '2023-03-10', '2022-12-31'))
        self.assertIsNone(svb['asset_rank'])
        report = json.loads((bd.OUT / 'bank_24735.json').read_text())['report']
        self.assertEqual(report['institution']['status'], 'failed')

    def test_case_study_with_mismatched_name_is_skipped(self):
        self.assertNotIn(59017, self.banks)
        self.assertTrue(any('59017' in w and 'does not match' in w for w in self.manifest['warnings']))

    def test_summary_matches_report_metrics(self):
        report = json.loads((bd.OUT / 'bank_628.json').read_text())['report']
        s = self.banks[628]['summary']
        self.assertAlmostEqual(s['equity_assets_pct'], report['metrics']['equity_assets_pct'], places=3)
        self.assertEqual(s['assets'], report['latest']['assets'])
        self.assertEqual(s['watch_count'], report['monitor_count'])

    def test_demo_is_labeled_and_first(self):
        first = self.manifest['banks'][0]
        self.assertEqual((first['mode'], first['status']), ('demo', 'fictional'))

    def test_foreign_branch_excluded_and_ranks_close_up(self):
        self.assertNotIn(33692, self.banks)
        self.assertEqual(self.banks[14]['asset_rank'], 2)  # ranked second once the branch is removed

    def test_us_date_and_display_name_helpers(self):
        self.assertEqual(bd.us_date('03/10/2023'), '2023-03-10')
        self.assertIsNone(bd.us_date(''))
        self.assertEqual(bd.display_name('Citibank, National Association'), 'Citibank, N.A.')
        self.assertEqual(bd.display_name('Truist Bank'), 'Truist Bank')
        self.assertEqual(bd.display_name('Frost  Bank'), 'Frost Bank')


class FallbackTests(unittest.TestCase):
    def test_ranking_failure_uses_fallback_list(self):
        def broken(endpoint, params, attempts=3):
            if params.get('fields') == 'REPDTE':
                raise RuntimeError('down')
            return fake_fdic(endpoint, params, attempts)
        saved = bd.fdic_get
        bd.fdic_get = broken
        try:
            warnings = []
            sel, _ = bd.select_banks(warnings)
        finally:
            bd.fdic_get = saved
        self.assertEqual([b['cert'] for b in sel][:3], [c for c, _ in bd.FALLBACK_BANKS])
        self.assertTrue(warnings)


if __name__ == '__main__':
    unittest.main()
