# feed-digest

Automated tech watch pipeline. Collects unread articles from InoReader, enriches them via an LLM (Claude or Gemini) with summaries, tags, and importance levels, then stores them in Google Sheets or Notion. The user receives an interactive Telegram notification to filter articles by tags.

## Architecture

Hexagonal architecture (Ports & Adapters) in an NX monorepo:

```
libs/core/          Interfaces (ports) and domain models
libs/adapters/      Concrete implementations
  scraper/          InoreaderAdapter (Playwright)
  storage/          GoogleSheetsAdapter, NotionAdapter
  llm/              ClaudeAdapter, GeminiAdapter
  notifier/         TelegramAdapter
  session/          DynamoDbAdapter, FileSessionAdapter
  tag-preference/   DynamoDbTagPreferenceAdapter, FileTagPreferenceAdapter
libs/pipeline/      Pipeline orchestration
apps/scraper/       CLI entry point (composition root)
apps/webhook/       AWS Lambda handler for Telegram callbacks + REST API
apps/dashboard/     Angular web UI: inbox, triage, saved articles, tag preferences
```

## Local setup

```bash
# Install
npm install
npx playwright install chromium

# Configure environment variables
cp .env.example .env
# Fill in the .env file

# Set up storage backend schema (Notion or Google Sheets based on STORAGE_BACKEND)
npm run setup

# Run the pipeline (bypass time window)
npm run scraper

# Run the webhook server (Telegram polling mode)
npm run webhook

# Fix publication dates (re-fetch real dates from source URLs)
npm run fix-dates
```

## Main environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `INOREADER_EMAIL` / `INOREADER_PASSWORD` | InoReader credentials | - |
| `LLM_PROVIDER` | `claude` or `gemini` | `claude` |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | LLM API key | - |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google service account JSON (if `google-sheets`) | - |
| `GOOGLE_SHEET_ID` | Target Google Sheet ID (if `google-sheets`) | - |
| `NOTION_API_KEY` | Notion integration API key (if `notion`) | - |
| `NOTION_INBOX_DB_ID` | Notion Inbox database ID (if `notion`) | - |
| `NOTION_ALL_DB_ID` | Notion All database ID (if `notion`) | - |
| `NOTION_SAVED_DB_ID` | Notion Saved database ID (if `notion`) | - |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram bot configuration | - |
| `SUMMARY_LANG` | Summary and message language (`fr`, `en`) | `fr` |
| `SCRAPER_SOURCE` | Scraping sources, comma-separated (`inoreader`, `inoreader-saved`) | `inoreader` |
| `STORAGE_BACKEND` | Storage backend (`google-sheets` or `notion`) | `google-sheets` |
| `ARTICLES_LIMIT` | Max articles per run | `150` |
| `MAX_TAGS` | Max tags per article | `3` |
| `SHOW_BROWSER` | Show Playwright browser | `false` |
| `RUN_NOW` | Bypass Paris time window | `false` |
| `DYNAMODB_TAG_PREF_TABLE_NAME` | DynamoDB table for tag preferences (prod) | - |
| `TAG_PREFERENCE_THRESHOLD` | Score above which a tag is auto-selected | `0.6` |
| `TAG_PREFERENCE_MIN_RUNS` | Minimum presentations before auto-selection | `3` |
| `USER_INTERESTS` | Free-text interest profile for LLM relevance scoring | - |
| `API_PORT` | Port for the local dashboard API server | `3333` |

## Pipeline flow

1. **Scraping**: collects articles from InoReader — unread (`inoreader`) or starred (`inoreader-saved`) depending on `SCRAPER_SOURCE` (FIFO, max 150)
2. **Content fetching**: fetches each article's source page, extracts full text via Readability and the real publication date from HTML meta tags / JSON-LD
3. **Enrichment**: summary, tags, and relevance score via LLM. The LLM also computes a `relevanceScore` (1-10) based on the user's interest profile (`USER_INTERESTS`). Importance is **not** determined by the LLM — it is computed from your tag preferences:
   - Tag with `auto` override or high selection score → **high**
   - All tags `filtered` → **low**
   - Otherwise → **medium**
4. **Storage**: all articles go to Inbox + All (Google Sheets or Notion depending on `STORAGE_BACKEND`). For `inoreader-saved`, processed articles are unstarred on InoReader. Articles also store `relevanceScore` and optional `snoozedUntil` fields.
5. **Telegram notification**: a single rich summary message with pipeline funnel (collected → deduped → noise-filtered → processed), importance breakdown (high/medium/low), average relevance score, top 5 sources, LLM usage (calls + tokens in/out), and run duration.
6. **Preference learning**: tag preferences are learned from dashboard interactions. Tags can be manually overridden to `auto` (always pre-selected) or `filtered` (hidden) via the dashboard.

## Dashboard

The Angular dashboard (`apps/dashboard`) provides eight views:

- **Inbox**: browse, filter, and bulk-manage articles. Includes temporal histogram (day/week/month/year), top tags and sources charts, AI summary generation with period options, advanced filters (scraper source, tags), keyboard shortcuts (`?` to list them), tag-based clustering with per-article dates, checkboxes, bulk save/delete per cluster, recursive splitting for large clusters, cluster stats toolbar with refresh, snooze presets, and relevance score display. Search covers title, summary, and tags with relevance scoring.
- **Triage**: single-article-at-a-time quick processing — Save, Pass, or Skip with keyboard shortcuts.
- **Saved**: browse and manage saved articles with the same filtering capabilities.
- **Tag Preferences**: view and override tag auto-selection behavior.
- **Snoozed**: view and manage snoozed articles, unsnooze on demand.
- **Interests**: edit your interest profile (free text), used by the LLM for relevance scoring.
- **Reader** (Focus Mode): clean reading view with 70ch max-width typography, summary/full content toggle, reading time estimate, table of contents panel, and score display. Accessible via "Read" buttons on inbox and saved articles.

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full development guide.
