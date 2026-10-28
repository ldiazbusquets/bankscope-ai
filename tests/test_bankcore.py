import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bankcore.analytics import (build_report, calculate_metrics, stress_test, baseline_memo, monitor_signals,
                                parse_fdic_record, foreign_deposits)
from bankcore.sample import demo_records

# Silicon Valley Bank (FDIC cert 24735), quarter ended 2022-12-31, from FDIC BankFind /financials
# (USD thousands; securities and deposit splits rounded to $0.1B when captured on 2026-10-28).
SVB = {
    'date': '2022-12-31', 'assets': 209026000, 'deposits': 175378000, 'equity': 15456000, 'loans': 74254000,
    'cash': 12511000, 'uninsured_deposits': 151592000, 'domestic_deposits': 161479000, 'foreign_deposits': 13900000,
    'afs_fair': 26000000, 'afs_cost': 28500000, 'htm_cost': 91300000, 'htm_fair': 76200000,
    'cet1_pct': 15.26, 'tier1_leverage_pct': 7.96, 'rwa': 111300000, 'tier1_capital': 17000000,
    'risk_based_capital_pct': 16.05, 'noncurrent_loans_pct': 0.19,
}


class BankcoreTests(unittest.TestCase):
    def setUp(self):
        self.records = demo_records()
        self.rec = self.records[-1]

    def test_ratio(self):
        ratios = calculate_metrics(self.rec)
        self.assertAlmostEqual(ratios['equity_assets_pct'], 5_180_000 / 53_500_000 * 100)

    def test_cash_gap_domestic_only(self):
        result = stress_test(self.rec, 50, 2, include_foreign=False)
        self.assertAlmostEqual(result['assumed_deposit_outflow'], 7_100_000)
        self.assertAlmostEqual(result['cash_only_funding_gap'], 400_000)

    def test_loss(self):
        result = stress_test(self.rec, 25, 2)
        self.assertAlmostEqual(result['credit_loss'], 710_000)
        self.assertAlmostEqual(result['equity_after_credit_loss'], 4_470_000)

    def test_invalid_shock(self):
        with self.assertRaises(ValueError):
            stress_test(self.rec, 150, 0)
        with self.assertRaises(ValueError):
            stress_test(self.rec, 10, 0, securities_haircut_pct=-1)

    def test_missing_field(self):
        rec = {**self.rec, 'deposits': None}
        self.assertIsNone(calculate_metrics(rec)['cash_deposits_pct'])
        self.assertIsNone(calculate_metrics(rec)['loans_deposits_pct'])

    def test_brief_and_provenance(self):
        rpt = build_report(name='Fictional', cert=999999, records=self.records, source='demo')
        self.assertEqual(rpt['data_mode'], 'demo')
        self.assertIn('ILLUSTRATIVE', baseline_memo(rpt)['subtitle'])


class FieldMappingTests(unittest.TestCase):
    def test_new_fdic_fields_map_and_missing_stay_null(self):
        rec = parse_fdic_record({'REPDTE': '20260630', 'SCAF': 5, 'SCAA': 6, 'SCHA': 7, 'SCHF': 4, 'DEPFOR': 3,
                                 'IDT1CER': 12.5, 'RBC1AAJ': 9.1, 'RWAJ': 100, 'RBCT1J': 13})
        self.assertEqual((rec['afs_fair'], rec['afs_cost'], rec['htm_cost'], rec['htm_fair']), (5, 6, 7, 4))
        self.assertEqual((rec['foreign_deposits'], rec['cet1_pct'], rec['tier1_leverage_pct'], rec['rwa'], rec['tier1_capital']), (3, 12.5, 9.1, 100, 13))
        self.assertIsNone(parse_fdic_record({'REPDTE': '20260630'})['htm_fair'])

    def test_foreign_deposits_fallback(self):
        self.assertEqual(foreign_deposits({'deposits': 100, 'domestic_deposits': 80}), 20)
        self.assertEqual(foreign_deposits({'foreign_deposits': 0, 'deposits': 100, 'domestic_deposits': 80}), 0)
        self.assertEqual(foreign_deposits({}), 0)


class SVBCaseTests(unittest.TestCase):
    def setUp(self):
        self.m = calculate_metrics(SVB)
        self.flags = {s['metric']: s['flag'] for s in monitor_signals(self.m)}

    def test_hidden_htm_loss_nearly_equals_equity(self):
        self.assertAlmostEqual(self.m['htm_unrealized_loss'], 15_100_000)
        self.assertAlmostEqual(self.m['htm_loss_equity_pct'], 15_100_000 / 15_456_000 * 100)
        self.assertGreater(self.m['htm_loss_equity_pct'], 95)

    def test_liquid_coverage(self):
        expected = (12_511_000 + 26_000_000) / (151_592_000 + 13_900_000) * 100
        self.assertAlmostEqual(self.m['liquid_coverage_pct'], expected)

    def test_regulatory_ratios_pass_but_heuristics_flag(self):
        # The teaching point: SVB looked well capitalized on PCA ratios.
        for k in ('cet1_pct', 'tier1_leverage_pct', 'risk_based_capital_pct'):
            self.assertFalse(self.flags[k], k)
        self.assertTrue(self.flags['liquid_coverage_pct'])
        self.assertTrue(self.flags['htm_loss_equity_pct'])

    def test_severe_run_forces_htm_sales_and_realizes_losses(self):
        s = stress_test(SVB, 50, 0, securities_haircut_pct=5)
        outflow = (151_592_000 + 13_900_000) * 0.5
        self.assertAlmostEqual(s['assumed_deposit_outflow'], outflow)
        self.assertAlmostEqual(s['cash_used'], 12_511_000)
        self.assertAlmostEqual(s['afs_sold'], 26_000_000)                    # all AFS sold
        self.assertAlmostEqual(s['afs_proceeds'], 26_000_000 * 0.95)
        htm_need = outflow - 12_511_000 - 26_000_000 * 0.95
        self.assertAlmostEqual(s['htm_proceeds'], htm_need)
        self.assertAlmostEqual(s['htm_sold'], htm_need / 0.95)
        self.assertAlmostEqual(s['realized_htm_loss'], 15_100_000 * (htm_need / 0.95) / 76_200_000)
        self.assertAlmostEqual(s['funding_gap'], 0)
        self.assertLess(s['cet1_after_pct'], s['cet1_before_pct'] - 8)      # a large capital hit
        self.assertLess(s['equity_after'], 15_456_000 * 0.25)

    def test_without_htm_sales_a_gap_remains(self):
        s = stress_test(SVB, 50, 0, allow_htm_sales=False)
        self.assertEqual(s['htm_sold'], 0)
        self.assertEqual(s['realized_htm_loss'], 0)
        self.assertGreater(s['funding_gap'], 40_000_000)

    def test_small_run_uses_cash_only(self):
        s = stress_test(SVB, 5, 0)
        self.assertEqual((s['afs_sold'], s['htm_sold'], s['haircut_loss']), (0, 0, 0))
        self.assertAlmostEqual(s['equity_after'], SVB['equity'])

    def test_zero_haircut_and_full_runoff_bounds(self):
        s = stress_test(SVB, 100, 0, securities_haircut_pct=0)
        self.assertLessEqual(s['htm_sold'], 76_200_000 + 1e-6)
        self.assertGreaterEqual(s['funding_gap'], 0)


class MemoTests(unittest.TestCase):
    def test_memo_separates_benchmarks_and_heuristics(self):
        rpt = build_report(name='SILICON VALLEY BANK', cert=24735, records=[SVB], source='live')
        memo = baseline_memo(rpt)
        self.assertIn('well-capitalized benchmarks', memo['interpretation'])
        self.assertIn('$15.1B', ' '.join(memo['points']))
        self.assertEqual(memo['generation'], 'rules-based')


if __name__ == '__main__':
    unittest.main()
