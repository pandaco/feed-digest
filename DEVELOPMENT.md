# Development Guide — feed-digest

This guide explains how to set up, run, and test the **feed-digest** project locally.

---

## 1. Local Environment Setup

### 1.1 Prerequisites
- **Node.js**: v22 or higher.
- **NX CLI**: Installed globally (`npm install -g nx`) or use `npx nx`.
- **Playwright**: Installed and browsers initialized (for InoreaderScraper).
- **Storage backend** (pick one):
  - **Google Sheets**: a Google service account with access to the target Sheet.
  - **Notion**: a Notion integration with access to the 3 databases (Inbox, All, Saved).
- **Telegram Bot**: A token from @BotFather.

### 1.2 Installation
```bash
# Clone the repository
git clone <your-repo-url>
cd feed-digest

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium
```

### 1.3 Environment Variables
Create a `.env` file at the root of the project by copying the example:
```bash
cp .env.example .env
```
Fill in the following variables in `.env`:
- `INOREADER_EMAIL` / `INOREADER_PASSWORD`
- `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`
- `LLM_PROVIDER` (claude or gemini)
- `SUMMARY_LANG` (fr or en)
- If `STORAGE_BACKEND=google-sheets`:
  - `GOOGLE_SERVICE_ACCOUNT_JSON` (the full JSON string)
  - `GOOGLE_SHEET_ID`
  - Run `npm run setup` to create the tabs and headers automatically
- If `STORAGE_BACKEND=notion`:
  - `NOTION_API_KEY`
  - `NOTION_INBOX_DB_ID`, `NOTION_ALL_DB_ID`, `NOTION_SAVED_DB_ID`
  - Run `npm run setup` to provision the Notion database schema
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SCRAPER_SOURCE` (comma-separated: `inoreader` for unread, `inoreader-saved` for starred, e.g. `inoreader,inoreader-saved`)
- `STORAGE_BACKEND` (`google-sheets` or `notion`, default: `google-sheets`)
- `SHOW_BROWSER` (set to `true` to show Playwright browser window)
- `RUN_NOW` (set to `true` to bypass the Paris time window guard)
- `DYNAMODB_ARTICLES_TABLE_NAME` (optional for local, see below)
- `DYNAMODB_TAG_PREF_TABLE_NAME` (optional for local, see below)
- `TAG_PREFERENCE_THRESHOLD` (default: `0.6` — minimum score for auto-selection)
- `TAG_PREFERENCE_MIN_RUNS` (default: `3` — minimum presentations before auto-selection kicks in)
- `USER_INTERESTS` (free-text interest profile for LLM relevance scoring, also editable via dashboard)
- `API_PORT` (default: `3333` — port for the local NestJS API server)

---

## 2. Running the Scraper Locally

To run the full scraping and enrichment pipeline from your machine:

```bash
# Run with the Paris time window guard (default)
npx tsx --tsconfig tsconfig.base.json apps/scraper/src/main.ts

# Force a run now (bypassing the time window guard)
RUN_NOW=true npx tsx --tsconfig tsconfig.base.json apps/scraper/src/main.ts

# Or use the npm script (forces RUN_NOW=true)
npm run scraper
```

> **Note**: In `development` mode (`NODE_ENV=development` in your `.env`), the scraper uses **local files** instead of AWS DynamoDB: `session-store.json` for the session and `tag-preferences.json` for learned tag preferences. This allows you to test the entire pipeline without an AWS account.

### Fix publication dates

If existing articles have incorrect `publishedAt` dates (e.g. set to the scraping time instead of the real publication date), you can fix them in bulk:

```bash
npm run fix-dates
```

This script fetches each article's source URL, extracts the real publication date from HTML meta tags (`article:published_time`, `datePublished`, JSON-LD, etc.), and updates the storage. Articles where no date can be found are skipped.

---

## 3. Running the Dashboard Locally

The dashboard needs two processes: the NestJS API and the Angular dev server. The Angular dev server proxies all `/api` calls to `localhost:3333` automatically (`apps/dashboard/proxy.conf.json`).

```bash
# Start both simultaneously (recommended)
npm run dev

# Or start each in a separate terminal
npm run api        # NestJS API  →  http://localhost:3333/api
npm run dashboard  # Angular UI  →  http://localhost:4200
```

First run after a fresh clone may take ~30 s while NX builds the project graph and Angular compiles.

> **API token**: the dashboard requires an `x-telegram-bot-api-secret-token` header on every request. Set it in the Settings panel (gear icon, top right). If `TELEGRAM_SECRET_TOKEN` is not set in your `.env`, the API accepts all requests without a token.

---

## 4. Notion Storage Configuration

If you use `STORAGE_BACKEND=notion`:

### 4.1 Create an integration
1. Go to https://www.notion.so/my-integrations
2. Create a new integration and copy the API key (`NOTION_API_KEY`)

### 4.2 Create the 3 databases and provision the schema
Create 3 empty Notion databases (Inbox, All, Saved), share each one with your integration, set the 3 IDs in `.env`, then run:
```bash
npm run setup
```
This creates all required properties automatically. You can also run it on an existing database to add missing columns without affecting existing data.

Required properties (created by `npm run setup`):

| Property | Notion Type |
|----------|-------------|
| Title | Title (default) |
| Article ID | Rich text |
| Run At | Rich text |
| Published At | Rich text |
| Source | Rich text |
| URL | URL |
| Tags | Rich text |
| Summary | Rich text |
| Importance | Rich text |
| Content Unavailable | Checkbox |
| LLM Provider | Rich text |
| Summary Language | Rich text |
| Scraper Source | Rich text |
| Snoozed Until | Rich text |
| Relevance Score | Number |

### 4.3 Share the databases and set IDs
For each database, click **"..."** > **"Connections"** > add your integration.

### 4.4 Retrieve the IDs
The database ID is found in its URL:
```
https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...
                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                      This is the database ID
```

Set `NOTION_INBOX_DB_ID`, `NOTION_ALL_DB_ID`, and `NOTION_SAVED_DB_ID` in `.env`.

---

## 5. Importance Computation

Article importance (`high` / `medium` / `low`) is computed at enrichment time from the relevance score and tag preferences, evaluated in strict priority order:

| Priority | Condition | Importance |
|----------|-----------|------------|
| 1 | Any tag has `auto` override | **high** |
| 2 | All tags have `filtered` override | **low** |
| 3 | `relevanceScore ≥ 7` | **high** |
| 4 | Any tag's selection score ≥ `TAG_PREFERENCE_THRESHOLD` (after ≥ `TAG_PREFERENCE_MIN_RUNS` presentations) | **high** |
| 5 | `relevanceScore ≤ 3` | **low** |
| 6 | Default | **medium** |

If `USER_INTERESTS` is not configured, `relevanceScore` is not generated by the LLM and rules 3 and 5 never apply — everything defaults to **medium** unless you set tag overrides.

**`relevanceScore`** (1–10) is produced by the LLM during enrichment based on your interest profile (`USER_INTERESTS`). Edit this profile in the **Interests** tab of the dashboard or directly in `.user-interests.txt`.

**Tag preference learning:** each time you save or delete an article via the dashboard (or triage), the API calls `tagPreference.record()` using `TELEGRAM_CHAT_ID` as the identifier. Saved articles record their tags as selected (`true`); deleted articles record their tags as presented but not selected (`false`). A score `selectionCount / presentedCount` is computed per tag. Tags that consistently appear in saved articles eventually contribute to **high** importance (rule 4 above).

**Tag overrides** take absolute priority (rules 1–2) and are set via the **Tag Preferences** tab:
- **`auto`** — tag always pushes importance to **high**.
- **`filtered`** — tag hides the article and pushes importance to **low** when all tags are filtered.
- **`default`** (no override) — score-based behavior.

**Storage:** `tag-preferences.json` locally (`NODE_ENV=development`), DynamoDB table (`DYNAMODB_TAG_PREF_TABLE_NAME`) in production.

---

## 6. Dashboard (Angular)

The dashboard is a standalone Angular web application for visualizing and managing tag preferences.

### Running locally
```bash
npx nx serve dashboard
```
The app will be available at `http://localhost:4200`.

### Features

**Inbox**
- Browse all inbox articles with title, source, tags, importance, relevance score, and publication date
- Stats bar: total count, high/medium/low breakdown, unique tag count, and untagged counter — if untagged articles exist, a "Taguer" button re-runs LLM enrichment on them with a live streaming progress bar
- Top 10 tags and top 5 sources histograms (clickable to activate filters)
- Temporal histogram (day / week / month / year granularity, clickable to filter by time range)
- AI summary generation for today / this week / this month / all / currently filtered articles
- Expand any article to view its full summary and metadata
- Filter by importance, source (multi-select), scraper source, tags (multi-select), time range, and free-text search (title + summary + tags)
- Sort by published date, run date, importance, or relevance score
- Bulk selection (per-article or select-all visible) with bulk delete and bulk save
- Tag-based clustering view: collapsible cluster groups, "Save best + archive rest" action, bulk save/delete per cluster, cluster synthesis via LLM, warning when untagged articles may degrade clustering quality
- Snooze articles with presets
- Keyboard shortcuts (`?` to list)
- "Read" button to open articles in focus mode reader view

**Triage**
- Single-article-at-a-time quick processing with keyboard shortcuts (Save / Pass / Skip)

**Saved**
- Browse all saved articles with the same filtering and sorting as Inbox
- Bulk remove

**Snoozed**
- View all snoozed articles with their snooze expiry date; unsnooze on demand

**Tag Preferences**
- View all tracked tags with selection scores (progress bars)
- Filter by state (All / Auto / Default / Filtered) and search by name
- Change tag state directly from the table
- Stats: run count, tag counts by state, average selection rate, threshold
- Reset all preferences

**Interests**
- Edit your interest profile as free text (e.g. `"AI, distributed systems, climate tech"`)
- Stored as `.user-interests.txt`, injected into the LLM enrich prompt — drives `relevanceScore` (1–10) and therefore article importance

**Reader (Focus Mode)**
- Clean reading view accessible via `/reader/:articleId/:source`
- 70ch typography, reading time estimate, table of contents panel
- Toggle between article summary and full original content (fetched on demand)
- Relevance score and tags display; direct link to original article

### API Endpoints
The dashboard connects to the NestJS REST API. All requests require the `x-telegram-bot-api-secret-token` header (set your API token in the dashboard settings).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/inbox` | List active (non-snoozed) articles |
| `GET` | `/api/inbox/snoozed` | List snoozed articles |
| `POST` | `/api/inbox/retag-untagged` | Re-enrich untagged inbox articles via LLM — streams SSE progress events (`start` / `progress` / `done` / `error`) |
| `POST` | `/api/inbox/bulk-delete` | Delete multiple articles (`{ "articleIds": [...] }`) |
| `POST` | `/api/inbox/save` | Move articles to saved (`{ "articleIds": [...] }`) |
| `POST` | `/api/inbox/summary` | Generate an AI summary — body: `{ "period": "today" \| "week" \| "month" }` (omit for all) |
| `POST` | `/api/inbox/synthesize` | Synthesize selected articles via LLM (`{ "articleIds": [...] }`) |
| `POST` | `/api/inbox/:articleId/snooze` | Snooze an article (`{ "snoozedUntil": "ISO 8601 date" }`) |
| `POST` | `/api/inbox/:articleId/unsnooze` | Unsnooze an article |
| `DELETE` | `/api/inbox/:articleId` | Delete a single article |
| `GET` | `/api/saved` | List all saved articles |
| `DELETE` | `/api/saved/:articleId` | Remove a single article from saved |
| `POST` | `/api/saved/bulk-delete` | Remove multiple articles from saved (`{ "articleIds": [...] }`) |
| `GET` | `/api/preferences/:chatId` | Get preferences with computed scores, overrides, and run count |
| `POST` | `/api/preferences/:chatId/tags/:tag/override` | Set a tag override (`{ "override": "auto" \| "filtered" \| null }`) |
| `DELETE` | `/api/preferences/:chatId` | Reset all preferences |
| `GET` | `/api/interests` | Get user interest profile (text) |
| `POST` | `/api/interests` | Save user interest profile (`{ "text": "..." }`) |
| `GET` | `/api/articles/:articleId/content` | Fetch full article content (HTML + word count) |
| `GET` | `/api/articles/:articleId/toc` | Extract table of contents (h2/h3 headings) |

---

## 7. Working without DynamoDB Locally

If you want to test the `DynamoDbAdapter` locally:
1. **Install DynamoDB Local**: Use Docker: `docker run -p 8000:8000 amazon/dynamodb-local`.
2. **Configure Adapter**: Pass `endpoint: 'http://localhost:8000'` and dummy credentials to the `DynamoDBClient` in your adapter (only for local dev).

---

## 8. Production Configuration (AWS & GitHub)

### 8.1 AWS SSM Parameters (One-time)
Populate your production secrets in AWS SSM (SecureString):
```bash
# Example for one parameter (repeat for all needed by serverless.yml)
aws ssm put-parameter \
  --name /feed-digest/prod/TELEGRAM_BOT_TOKEN \
  --value "your-token" \
  --type SecureString \
  --region eu-central-1
```

### 8.2 GitHub Secrets
Add these secrets to your GitHub Repository:
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- `INOREADER_EMAIL` / `INOREADER_PASSWORD`
- `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SHEET_ID` (if Google Sheets)
- `NOTION_API_KEY` / `NOTION_INBOX_DB_ID` / `NOTION_ALL_DB_ID` / `NOTION_SAVED_DB_ID` (if Notion)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`

### 8.3 GitHub Variables
Add these variables (Settings > Secrets and variables > Actions > Variables):
- `LLM_PROVIDER` — `claude` or `gemini`
- `SUMMARY_LANG` — `fr` or `en`
- `ARTICLES_LIMIT` — max articles per run (default: `150`)
- `MAX_TAGS` — max tags per article (default: `3`)
- `PIPELINE_CONCURRENCY` — parallel enrichments (default: `5`)
- `PIPELINE_MIN_DELAY_MS` / `PIPELINE_MAX_DELAY_MS` — rate-limit jitter
- `SCRAPER_SOURCE` — `inoreader`, `inoreader-saved`, or both
- `STORAGE_BACKEND` — `google-sheets` or `notion`
- `TAG_PREFERENCE_THRESHOLD` / `TAG_PREFERENCE_MIN_RUNS` — auto-selection tuning
- `USER_INTERESTS` — free-text interest profile for LLM relevance scoring

### 8.4 Deployment
Simply push to `main`. The `deploy-lambda` workflow will handle the AWS deployment, and the `scraper` workflow will run six times daily every 3 hours (07h, 10h, 13h, 16h, 19h, 22h Paris time — with both winter/summer UTC variants). The `TZ=Europe/Paris` env var ensures logs and Telegram notifications display Paris time.

---

## 9. Project Architecture Reminder
- **libs/core**: Pure domain logic, models, and port interfaces. No external dependencies.
- **libs/adapters**: Concrete implementations:
  - `scraper/inoreader.scraper.ts` — InoReader scraping via Playwright
  - `storage/google-sheets.storage.ts` — Google Sheets storage
  - `storage/notion.storage.ts` — Notion database storage
  - `llm/claude.llm.ts` / `llm/gemini.llm.ts` — LLM enrichment
  - `notifier/telegram.notifier.ts` — Telegram notifications
  - `session/dynamodb.adapter.ts` / `session/in-memory-session.adapter.ts` — Session persistence
  - `tag-preference/dynamodb.tag-preference.ts` / `tag-preference/file.tag-preference.ts` — Tag preference learning
- **libs/pipeline**: Orchestration (the "Glue") between the ports.
- **apps/scraper**: CLI entry point (composition root).
- **apps/api**: NestJS API server (dashboard backend + AWS Lambda handler).
- **apps/dashboard**: Angular web UI: inbox browser (with clustering, snooze, relevance scores), saved articles, triage, tag preferences, snoozed articles, user interests, focus mode reader.
