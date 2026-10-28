# BankScope AI — FIN 414

Educational banking-risk research terminal. Built for GitHub Pages and GitHub Actions; no local Python installation required.

## How it works

1. GitHub Actions runs Python unit tests and retrieves publicly available quarterly bank financial statements from the FDIC BankFind API.
2. Python calculates risk indicators and saves static JSON files in `site/data/`.
3. Optionally, an AI model creates short research notes during the workflow using an API key stored in GitHub Secrets.
4. GitHub Pages publishes the `site/` folder. Visitors use the dashboard and interactive scenario calculations in their browsers.

The project includes an explicitly **fictional** Northstar Regional Bank demo. Live bank entries appear only when FDIC retrieval succeeds. AI notes are **pre-generated**, not an interactive live chatbot.

## Deploy without installing anything

1. Create a public GitHub repository called `bankscope-ai` on your account.
2. Upload **the contents of this folder** to the repository root. Preserve `.github/workflows/publish.yml` and the other folder names. Do not upload the enclosing folder as an extra level.
3. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Go to **Actions → Publish BankScope → Run workflow → Run workflow**. Alternatively, pushing the files to the `main` branch starts the workflow automatically.
5. Wait for both the `build` and `deploy` jobs to finish successfully. Visit `https://YOUR_USERNAME.github.io/bankscope-ai/`.
6. If the workflow fails, inspect its failed step in **Actions**. The `Update FDIC data using Python` step prints warnings if an institution cannot be retrieved.

## Optional AI-generated reports

Without an API key, the site works with deterministic Python-written research summaries. For optional LLM research notes, set repository **Settings → Secrets and variables → Actions**:

- **Repository secret** `AI_API_KEY`: your provider API key. Never commit this key into the repository or put it in browser JavaScript.
- **Repository variable** `AI_MODEL`: a model identifier compatible with your chosen provider (for example, `gpt-4o-mini` for OpenAI).
- **Repository variable** `AI_BASE_URL`: the provider's OpenAI-compatible API base URL (for example, `https://api.openai.com/v1`).

Then rerun the workflow. AI generation may incur charges. Not all model providers use the same API format. If the optional AI call fails, the ordinary research briefs remain available.

## Files

- `.github/workflows/publish.yml` — Python build, tests, optional AI, GitHub Pages deployment, scheduled Monday updates.
- `bankcore/analytics.py` — financial calculations and data normalization.
- `bankcore/sample.py` — fictional sample financial data.
- `scripts/build_data.py` — FDIC API retrieval and JSON generation.
- `scripts/generate_ai.py` — optional secure AI report generation during Actions.
- `site/` — the complete static website, including CSS, JavaScript, and JSON.
- `tests/` — financial unit tests.

## Important limitations

This is an educational screening tool, **not** an official FDIC rating, regulatory capital assessment, or investment recommendation. Ratios are screening proxies. Stress scenarios use simplifying assumptions, not a calibrated regulatory stress-testing model. The FDIC API is quarterly; a weekly workflow check does not imply weekly underlying financial updates. GitHub Actions cannot serve an on-demand Python chatbot to website visitors.

## Local optional testing

`python -m unittest discover -s tests -v`

`python scripts/build_data.py --offline`

For a local browser preview, serve `site/` with `python -m http.server 8000 --directory site` and open `http://localhost:8000`.
