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
apps/webhook/       AWS Lambda handler for Telegram callbacks + Preferences API
apps/dashboard/     Angular web UI for tag preference management
```

## Local setup

```bash
# Install
npm install
npx playwright install chromium

# Configure environment variables
cp .env.example .env
# Fill in the .env file

# Run the pipeline (bypass time window)
npm run scraper

# Run the webhook server (Telegram polling mode)
npm run webhook
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
| `SCRAPER_SOURCE` | Scraping source | `inoreader` |
| `STORAGE_BACKEND` | Storage backend (`google-sheets` or `notion`) | `google-sheets` |
| `ARTICLES_LIMIT` | Max articles per run | `150` |
| `MAX_TAGS` | Max tags per article | `3` |
| `SHOW_BROWSER` | Show Playwright browser | `false` |
| `RUN_NOW` | Bypass Paris time window | `false` |
| `DYNAMODB_TAG_PREF_TABLE_NAME` | DynamoDB table for tag preferences (prod) | - |
| `TAG_PREFERENCE_THRESHOLD` | Score above which a tag is auto-selected | `0.6` |
| `TAG_PREFERENCE_MIN_RUNS` | Minimum presentations before auto-selection | `3` |

## Pipeline flow

1. **Scraping**: collects unread articles from InoReader (FIFO, max 150)
2. **Enrichment**: summary, tags, and importance via LLM (sequential, immediate save)
3. **Storage**: regular articles go to Inbox + All, saved articles go to Saved + All (Google Sheets or Notion depending on `STORAGE_BACKEND`)
4. **Telegram notification** (4+1 messages):
   - Run summary (stats, duration)
   - Statistics by RSS source
   - AI synthesis of trends
   - Interactive tag selection (inline buttons, with learned favorites pre-checked)
   - List of saved articles (if applicable)
5. **Filtering**: user selects tags to keep via Telegram
6. **Preference learning**: tag selections are recorded to auto-select favorites in future runs

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full development guide.
