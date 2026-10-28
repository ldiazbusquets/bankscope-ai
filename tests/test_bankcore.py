import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bankcore.analytics import build_report, calculate_metrics, stress_test, baseline_memo
from bankcore.sample import demo_records


class BankcoreTests(unittest.TestCase):
    def setUp(self):
        self.records = demo_records()
        self.rec = self.records[-1]

    def test_ratio(self):
        ratios = calculate_metrics(self.rec)
        self.assertAlmostEqual(ratios['equity_assets_pct'], 5_180_000 / 53_500_000 * 100)

    def test_cash_gap(self):
        result = stress_test(self.rec, 50, 2)
        self.assertAlmostEqual(result['assumed_deposit_outflow'], 7_100_000)
        self.assertAlmostEqual(result['cash_only_funding_gap'], 400_000)

    def test_loss(self):
        result = stress_test(self.rec, 25, 2)
        self.assertAlmostEqual(result['credit_loss'], 710_000)
        self.assertAlmostEqual(result['equity_after_credit_loss'], 4_470_000)

    def test_invalid_shock(self):
        with self.assertRaises(ValueError):
            stress_test(self.rec, 150, 0)

    def test_missing_field(self):
        rec = {**self.rec, 'deposits': None}
        self.assertIsNone(calculate_metrics(rec)['cash_deposits_pct'])
        self.assertIsNone(calculate_metrics(rec)['loans_deposits_pct'])

    def test_brief_and_provenance(self):
        rpt = build_report(name='Fictional', cert=999999, records=self.records, source='demo')
        self.assertEqual(rpt['data_mode'], 'demo')
        self.assertIn('ILLUSTRATIVE', baseline_memo(rpt)['subtitle'])


if __name__ == '__main__':
    unittest.main()
