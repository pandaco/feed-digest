# feed-digest

Automated tech-watch pipeline. Scrapes Inoreader, enriches each article
via an LLM (Claude / Gemini / local Ollama), stores everything in your
backend of choice (Notion / Google Sheets / DynamoDB) and pushes a rich
run summary to Telegram. Comes with an Angular dashboard for triage,
clustering, saved articles, snoozing, and tag-preference learning.

## Quick start

```bash
git clone <repo-url> && cd feed-digest
npm install
npx playwright install chromium
cp .env.example .env       # fill in the sections you actually use

npm run setup              # provisions schema for your STORAGE_BACKEND
npm run scraper            # one pipeline run (scrape → enrich → store → notify)
npm run dev                # API on :3333, dashboard on :4200
```

The smallest viable local stack is **Ollama + Notion** (no API quotas,
no AWS, ~5 GB model). Two other recipes (Gemini + Sheets, DynamoDB
Local) are spelled out in [DEVELOPMENT.md](DEVELOPMENT.md#2-local-dev-recipes).

## Docs

- **[DEVELOPMENT.md](DEVELOPMENT.md)** — local dev recipes, commands,
  architecture, pipeline flow, importance computation, dashboard
  features, API endpoints, production deploy.
- **[SETUP_GUIDE.md](SETUP_GUIDE.md)** — how to obtain the
  credentials for every external service (Notion, Google Sheets, AWS,
  Anthropic, Gemini, Ollama, Telegram, Inoreader).
- **[`.env.example`](.env.example)** — exhaustive env var reference;
  every key listed there is actually read by the code.
- **[CHANGELOG.md](CHANGELOG.md)** — release history.
- Per-package: [`libs/core`](libs/core/README.md),
  [`libs/adapters`](libs/adapters/README.md),
  [`libs/pipeline`](libs/pipeline/README.md).
