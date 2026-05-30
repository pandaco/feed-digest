# adapters

Concrete implementations of the ports defined in `libs/core`.

## Storage

| Adapter | Backend | Env vars required |
|---------|---------|-------------------|
| `DynamoDbStorageAdapter` | AWS DynamoDB | `DYNAMODB_ARTICLES_TABLE_NAME`, `AWS_REGION` |
| `NotionAdapter` | Notion databases | `NOTION_API_KEY`, `NOTION_INBOX_DB_ID`, `NOTION_ALL_DB_ID`, `NOTION_SAVED_DB_ID` |
| `GoogleSheetsAdapter` | Google Sheets | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID` |

Selected via `STORAGE_BACKEND` (`dynamodb` / `notion` / `google-sheets`).

## LLM

| Adapter | Provider | Env vars required |
|---------|----------|-------------------|
| `ClaudeAdapter` | Anthropic | `ANTHROPIC_API_KEY` |
| `GeminiAdapter` | Google | `GEMINI_API_KEY` |

Selected via `LLM_PROVIDER` (`claude` / `gemini`).

## Scraper

- `InoreaderAdapter` — Playwright-based InoReader scraper. Collects unread (`inoreader`) or starred (`inoreader-saved`) articles. Fetches full content via Readability and resolves real publication dates from HTML meta tags / JSON-LD.
- `CompositeScraper` — combines multiple scrapers when `SCRAPER_SOURCE` lists several sources.

## Tag Preference

| Adapter | Storage | When |
|---------|---------|------|
| `DynamoDbTagPreferenceAdapter` | DynamoDB table (`DYNAMODB_TAG_PREF_TABLE_NAME`) | Production |
| `FileTagPreferenceAdapter` | `tag-preferences.json` at project root | `NODE_ENV=development` |

## Notifier

- `TelegramAdapter` — sends rich pipeline summary to a Telegram chat. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

See [DEVELOPMENT.md](../../DEVELOPMENT.md) for setup instructions.
