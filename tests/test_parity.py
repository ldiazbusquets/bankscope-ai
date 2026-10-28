"""Python and browser stress engines must agree. Runs site/scenario.js in Node on the same
inputs as bankcore.analytics.stress_test and compares every numeric output. Skipped (not failed)
when Node is unavailable, so offline Python-only runs still work."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bankcore.analytics import stress_test  # noqa: E402
from bankcore.sample import demo_records  # noqa: E402
from tests.test_bankcore import SVB  # noqa: E402

NODE = shutil.which('node')
GRID = [
    dict(deposit_runoff_pct=r, credit_loss_pct=c, securities_haircut_pct=h, include_foreign=f, allow_htm_sales=a)
    for r in (0, 10, 25, 50, 75, 100) for c in (0, 2, 6) for h in (0, 5, 20) for f in (True, False) for a in (True, False)
]


@unittest.skipUnless(NODE, 'node not installed')
class ParityTests(unittest.TestCase):
    def run_js(self, rec):
        script = (
            "const s=require(process.argv[1]);const d=JSON.parse(require('fs').readFileSync(0,'utf8'));"
            "process.stdout.write(JSON.stringify(d.grid.map(o=>s.stressTest(d.rec,o))));"
        )
        out = subprocess.run([NODE, '-e', script, str(ROOT / 'site' / 'scenario.js')], input=json.dumps({'rec': rec, 'grid': GRID}),
                             capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    def check(self, rec):
        js = self.run_js(rec)
        for opts, j in zip(GRID, js):
            p = stress_test(rec, **opts)
            for k, pv in p.items():
                if k == 'assumptions':
                    continue
                jv = j.get(k)
                if isinstance(pv, (int, float)) and not isinstance(pv, bool) and pv is not None:
                    self.assertIsNotNone(jv, f'{k} missing in JS for {opts}')
                    self.assertAlmostEqual(pv, jv, delta=max(1e-6, abs(pv) * 1e-9), msg=f'{k} {opts}')
                else:
                    self.assertEqual(pv, jv, f'{k} {opts}')

    def test_parity_svb(self):
        self.check(SVB)

    def test_parity_demo(self):
        self.check(demo_records()[-1])

    def test_parity_missing_securities(self):
        rec = {k: v for k, v in SVB.items() if k not in ('afs_fair', 'afs_cost', 'htm_cost', 'htm_fair', 'rwa', 'tier1_capital')}
        self.check(rec)


if __name__ == '__main__':
    unittest.main()
