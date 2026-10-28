#!/usr/bin/env python3
"""Optional server-side model calls in GitHub Actions. Never executed by the browser.

Compatible with providers exposing OpenAI-style /chat/completions. A secret API key is
required. Output labels always distinguish model commentary from deterministic facts.
"""
from __future__ import annotations
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / 'site' / 'data'


def main():
    key = os.environ.get('AI_API_KEY', '').strip()
    if not key:
        print('AI_API_KEY not set: skipping optional AI reports; deterministic analysis is available.')
        return
    model = os.getenv('AI_MODEL', 'gpt-4o-mini').strip()
    base = os.getenv('AI_BASE_URL', 'https://api.openai.com/v1').strip().rstrip('/')
    parsed = urlparse(base)
    if parsed.scheme != 'https' or not parsed.hostname:
        raise ValueError('AI_BASE_URL must be a valid https URL')
    manifest_file = DIR / 'manifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    successful = 0
    for bank in manifest['banks']:
        if bank['mode'] != 'live':
            continue
        cert = bank['cert']
        evidence = json.loads((DIR / f'bank_{cert}.json').read_text(encoding='utf-8'))
        report = evidence['report']
        prompt = {
            'institution': report['institution'], 'as_of': report['as_of'],
            'metrics': report['metrics'], 'signals': report['signals'],
            'baseline_brief': evidence['brief'],
            'source_url': 'https://api.fdic.gov/banks/docs',
        }
        body = {
            'model': model,
            'temperature': 0.2,
            'max_tokens': 550,
            'messages': [
                {'role': 'system', 'content': (
                    'You are a cautious bank-risk analyst writing a concise educational research note. '
                    'Use ONLY the supplied structured FDIC data. DO NOT invent values, facts, trends, '
                    'quotes, ratios, sources, or regulatory findings. Explicitly separate facts from '
                    'interpretation and describe one important limitation. '
                    'Explain risk indicators as screening heuristics, NOT evidence of failure. '
                    'Use clear sections Strengths, Concerns, Follow-up questions, Limitations. '
                    'Never present as official FDIC ratings or financial advice.')},
                {'role': 'user', 'content': 'Write an evidence-bounded bank risk research note from this JSON:\n'
                 + json.dumps(prompt, ensure_ascii=False)},
            ],
        }
        req = Request(f'{base}/chat/completions', data=json.dumps(body).encode('utf-8'),
                      headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'}, method='POST')
        try:
            with urlopen(req, timeout=60) as resp:
                res = json.load(resp)
            answer = res['choices'][0]['message']['content']
            if not isinstance(answer, str) or not answer.strip():
                raise ValueError('Provider returned an empty response')
            info = {'bank_cert': cert, 'bank_as_of': report['as_of'], 'model': model,
                    'generated_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                    'answer': answer.strip(), 'is_ai_generated': True,
                    'caution': 'AI interpretation can be inaccurate; verify using underlying figures.'}
            (DIR / f'ai_{cert}.json').write_text(json.dumps(info, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
            successful += 1
            print(f'AI report generated for FDIC {cert}.')
        except Exception as exc:
            # Do not log auth headers or response bodies; do not block dashboard publish.
            print(f'WARNING: AI generation failed for {cert}: {type(exc).__name__}.')
    manifest['ai_enabled'] = successful > 0
    manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'{successful} AI report(s) generated.')


if __name__ == '__main__':
    main()
