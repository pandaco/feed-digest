# Development guide

Everything you need to run, debug, and extend **feed-digest** locally.
For obtaining third-party credentials (Notion API key, Google service
account, Ollama install, Telegram bot…), see [SETUP_GUIDE.md](SETUP_GUIDE.md).
For the env var reference, see [`.env.example`](.env.example).

---

## 1. Prerequisites

- **Node.js 22+** (CI runs Node 24).
- **npm** (no global installs needed; `npx nx` is used throughout).
- **Playwright Chromium**, installed once after `npm install`.
- Pick one storage backend and one LLM provider, then follow the matching
  recipe below.

```bash
git clone <repo-url> && cd feed-digest
npm install
npx playwright install chromium
cp .env.example .env
```

---

## 2. Local dev recipes

Each recipe is self-contained: fill in the listed env vars, run the
commands, and you have a working pipeline + dashboard. All three recipes
use the **file-based tag preference adapter** (no AWS needed) by leaving
`DYNAMODB_TAG_PREF_TABLE_NAME` empty.

### Recipe A — Zero-cost local stack (Ollama + Notion)

No API quotas, no AWS. Best for everyday dev.

1. Install Ollama and pull a model:
   ```bash
   ollama serve &              # or launch the Ollama menu-bar app
   ollama pull llama3.1:8b     # ~5 GB, one-time
   ```
2. Create the 3 Notion databases and an integration (see [SETUP_GUIDE](SETUP_GUIDE.md#11-notion-easiest)).
3. In `.env`:
   ```env
   LLM_PROVIDER=ollama
   STORAGE_BACKEND=notion
   NOTION_API_KEY=…
   NOTION_INBOX_DB_ID=…
   NOTION_ALL_DB_ID=…
   NOTION_SAVED_DB_ID=…
   INOREADER_EMAIL=…
   INOREADER_PASSWORD=…
   TELEGRAM_BOT_TOKEN=…    # optional in local dev
   TELEGRAM_CHAT_ID=…
   ```
4. Provision the Notion schema, run a scrape, open the dashboard:
   ```bash
   npm run setup       # creates Notion properties on the 3 DBs
   npm run scraper     # scrape → enrich → store → notify
   npm run dev         # API on :3333, dashboard on :4200
   ```

### Recipe B — Free cloud LLM + Google Sheets

Better summaries than 8B local models, still free (Gemini free tier).

1. Get a Gemini API key (see [SETUP_GUIDE](SETUP_GUIDE.md#22-gemini-google-ai-studio)).
2. Create a service account, share the spreadsheet (see [SETUP_GUIDE](SETUP_GUIDE.md#12-google-sheets)).
3. In `.env`:
   ```env
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=…
   STORAGE_BACKEND=google-sheets
   GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",…}
   GOOGLE_SHEET_ID=…
   INOREADER_EMAIL=… INOREADER_PASSWORD=…
   TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=…
   ```
4. Same commands as Recipe A: `npm run setup && npm run scraper && npm run dev`.

### Recipe C — DynamoDB Local (closest to prod)

Mirrors the AWS deployment. Useful for testing storage code paths.

1. Start DynamoDB Local:
   ```bash
   docker run -p 8000:8000 amazon/dynamodb-local
   ```
2. In `.env`:
   ```env
   STORAGE_BACKEND=dynamodb
   DYNAMODB_ENDPOINT=http://localhost:8000
   DYNAMODB_ARTICLES_TABLE_NAME=feed-digest-articles
   DYNAMODB_TAG_PREF_TABLE_NAME=feed-digest-tag-prefs
   AWS_REGION=eu-central-1
   AWS_ACCESS_KEY_ID=local
   AWS_SECRET_ACCESS_KEY=local
   ```
3. `npm run setup` creates both tables, then `npm run scraper && npm run dev`.

---

## 3. Commands cheat sheet

| Command            | What it does                                                         |
|--------------------|----------------------------------------------------------------------|
| `npm run scraper`  | One full pipeline run: scrape Inoreader → enrich → store → notify    |
| `npm run dev`      | API (`:3333`) + Angular dashboard (`:4200`) in parallel              |
| `npm run api`      | API only (NestJS)                                                    |
| `npm run dashboard`| Dashboard only (Angular dev server, proxies `/api` → `:3333`)        |
| `npm run setup`    | Provisions schema for the active `STORAGE_BACKEND` (Notion/Sheets/DDB) |
| `npm run fix-dates`| Bulk-corrects `publishedAt` by refetching real dates from source pages |
| `npm run recover`  | Re-enriches untagged inbox items and re-sends the Telegram summary   |
| `npm run purge`    | Deletes items older than `RETENTION_DAYS_ALL` (default 30)           |
| `npm run build`    | `nx run-many -t build` (all apps and libs)                           |
| `npm run test`     | `nx run-many -t test`                                                |
| `npm run lint`     | `nx run-many -t lint`                                                |
| `npm run release`  | `nx release` (conventional commits → version bump + CHANGELOG)       |

> **Dashboard auth.** Every API call requires the
> `x-telegram-bot-api-secret-token` header. Set it from the dashboard
> settings panel (gear icon). If `TELEGRAM_SECRET_TOKEN` is empty in
> `.env`, the API accepts all requests — convenient for local dev.

---

## 4. Architecture

Hexagonal (ports & adapters) in an Nx monorepo.

```
libs/core/           pure domain — entities, ports, utilities, no I/O
libs/adapters/       concrete implementations of every port
  scraper/           InoreaderScraper, CompositeScraper
  storage/           NotionStorage, GoogleSheetsStorage, DynamoDbStorage
  llm/               ClaudeLlm, GeminiLlm, OllamaLlm
  notifier/          TelegramNotifier
  tag-preference/    DynamoDbTagPreference, FileTagPreference
  factories.ts       env-driven adapter selection (createStorage, createLlm, …)
libs/pipeline/       runPipeline orchestration + computeImportance
apps/scraper/        CLI composition root (main.ts) + scripts (setup, recover, fix-dates, purge)
apps/api/            NestJS — dashboard backend (local) and Lambda handler (prod)
apps/dashboard/      Angular SPA — inbox, triage, saved, snoozed, prefs, interests, reader
```

Per-package READMEs: [`libs/core`](libs/core/README.md),
[`libs/adapters`](libs/adapters/README.md),
[`libs/pipeline`](libs/pipeline/README.md).

---

## 5. Pipeline flow

`runPipeline()` in `libs/pipeline/src/lib/pipeline.ts`:

1. **Collect** — `scraper.collect(limit)` returns up to `ARTICLES_LIMIT`
   raw items per source listed in `SCRAPER_SOURCE`.
2. **Fetch content** — full text via Mozilla Readability; real
   `publishedAt` extracted from `<meta>` tags / JSON-LD.
3. **Deduplicate & filter noise** — SHA-256 URL dedup, then drop items
   with empty or near-empty extractable text.
4. **Enrich (LLM)** — `llm.enrich()` returns
   `{ summary, tags, relevanceScore }`. Concurrency = `PIPELINE_CONCURRENCY`,
   with a random delay between calls bounded by `PIPELINE_{MIN,MAX}_DELAY_MS`.
5. **Compute importance** — see §6.
6. **Persist** — every article lands in Inbox + All. Starred items
   (`inoreader-saved`) also go to Saved and are unstarred on Inoreader.
7. **Notify** — single Telegram message: funnel (collected → deduped →
   noise-filtered → processed), importance breakdown, average relevance,
   top sources, LLM call/token usage, run duration.

---

## 6. Importance computation

Implemented in `libs/pipeline/src/lib/pipeline.ts` (`computeImportance`),
evaluated in strict priority order:

| Priority | Condition                                                                                       | Importance |
|----------|-------------------------------------------------------------------------------------------------|------------|
| 1        | Any tag has `auto` override                                                                     | **high**   |
| 2        | All tags have `filtered` override                                                               | **low**    |
| 3        | `relevanceScore ≥ 7`                                                                            | **high**   |
| 4        | Any tag's selection score ≥ `TAG_PREFERENCE_THRESHOLD` after ≥ `TAG_PREFERENCE_MIN_RUNS` runs    | **high**   |
| 5        | `relevanceScore ≤ 3`                                                                            | **low**    |
| 6        | Default                                                                                         | **medium** |

- **`relevanceScore` (1–10)** is produced by the LLM at enrich time when
  `USER_INTERESTS` is set; without it, rules 3 and 5 never fire.
- **Tag preference learning**: saving/deleting an article from the
  dashboard calls `tagPreference.record()`. A per-tag score
  `selectionCount / presentedCount` accrues over runs.
- **Tag overrides** (`auto` / `filtered` / default) are set in the
  Tag Preferences dashboard tab; they take absolute priority.

---

## 7. Dashboard

Angular standalone app at `http://localhost:4200`. Proxies `/api` to
the NestJS server on `:3333` (`apps/dashboard/proxy.conf.json`).

**Views**

- **Inbox** — list/cluster views, filters (importance, source, scraper
  source, tags, time range, free-text), sorts (date / run / importance /
  score), bulk save/delete, snooze presets, AI summary on any subset,
  one-click re-enrichment of untagged items via SSE progress, temporal
  histogram, top tags/sources charts (click-to-filter), keyboard
  shortcuts (`?`).
- **Triage** — single-article quick processing (Save / Pass / Skip)
  with shortcuts.
- **Saved** — saved articles browser, same filters/sorts as Inbox.
- **Snoozed** — snoozed list with expiry, manual unsnooze.
- **Tag preferences** — selection scores, override per tag
  (`auto` / `filtered` / default), reset.
- **Interests** — free-text profile persisted in `.user-interests.txt`,
  drives `relevanceScore`.
- **Reader** — clean focus mode (`/reader/:articleId/:source`) with
  70ch typography, ToC, summary/full-content toggle.

### API endpoints

All require header `x-telegram-bot-api-secret-token` (skipped when
`TELEGRAM_SECRET_TOKEN` is empty).

| Method   | Endpoint                                            | Description                                            |
|----------|-----------------------------------------------------|--------------------------------------------------------|
| `GET`    | `/api/inbox`                                        | List active (non-snoozed) articles                     |
| `GET`    | `/api/inbox/snoozed`                                | List snoozed articles                                  |
| `POST`   | `/api/inbox/retag-untagged`                         | Re-enrich untagged inbox via LLM (SSE progress)        |
| `POST`   | `/api/inbox/bulk-delete`                            | `{ articleIds: [...] }`                                |
| `POST`   | `/api/inbox/save`                                   | Move articles to saved                                 |
| `POST`   | `/api/inbox/summary`                                | AI summary (`{ period: 'today' \| 'week' \| 'month' }`) |
| `POST`   | `/api/inbox/synthesize`                             | Synthesize selected articles                           |
| `POST`   | `/api/inbox/:articleId/snooze`                      | `{ snoozedUntil: ISO-8601 }`                           |
| `POST`   | `/api/inbox/:articleId/unsnooze`                    |                                                        |
| `DELETE` | `/api/inbox/:articleId`                             |                                                        |
| `GET`    | `/api/saved`                                        |                                                        |
| `DELETE` | `/api/saved/:articleId`                             |                                                        |
| `POST`   | `/api/saved/bulk-delete`                            |                                                        |
| `GET`    | `/api/preferences/:chatId`                          | Scores, overrides, run count                           |
| `POST`   | `/api/preferences/:chatId/tags/:tag/override`       | `{ override: 'auto' \| 'filtered' \| null }`           |
| `DELETE` | `/api/preferences/:chatId`                          | Reset all preferences                                  |
| `GET`    | `/api/interests`                                    |                                                        |
| `POST`   | `/api/interests`                                    | `{ text: '...' }`                                      |
| `GET`    | `/api/articles/:articleId/content`                  | Full HTML + word count                                 |
| `GET`    | `/api/articles/:articleId/toc`                      | h2/h3 outline                                          |

---

## 8. Production deployment

The `apps/api` Lambda is deployed via the Serverless framework; the
scraper runs on GitHub Actions in the official Playwright container.

- **AWS SSM (one-time)** — store every production secret as `SecureString`
  under `/feed-digest/prod/<KEY>`. The Serverless config wires them into
  the Lambda env at deploy time.
- **GitHub Actions secrets** — `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `INOREADER_EMAIL`, `INOREADER_PASSWORD`, the LLM API key, the Notion or
  Google credentials, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **GitHub Actions variables** — `LLM_PROVIDER` (cloud only;
  `ollama` is local-only), `STORAGE_BACKEND`, `SCRAPER_SOURCE`,
  `SUMMARY_LANG`, `ARTICLES_LIMIT`, `MAX_TAGS`, `PIPELINE_CONCURRENCY`,
  `PIPELINE_{MIN,MAX}_DELAY_MS`, `TAG_PREFERENCE_THRESHOLD`,
  `TAG_PREFERENCE_MIN_RUNS`, `USER_INTERESTS`.
- **Deploy** — push to `main`. `deploy-lambda.yml` handles the API
  deployment; `scraper.yml` runs the pipeline every 3 hours from 07h to
  22h Paris time inside `mcr.microsoft.com/playwright:v1.58.2-noble`.
