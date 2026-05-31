# adapters

Concrete implementations of every port in [`libs/core`](../core/README.md).
Selected at runtime by the factories in `factories.ts` from environment
variables.

## Storage

| Class                | Backend         | `STORAGE_BACKEND` | Required env vars                                                   |
|----------------------|-----------------|-------------------|---------------------------------------------------------------------|
| `NotionStorage`      | Notion          | `notion`          | `NOTION_API_KEY`, `NOTION_{INBOX,ALL,SAVED}_DB_ID`                  |
| `GoogleSheetsStorage`| Google Sheets   | `google-sheets`   | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`                    |
| `DynamoDbStorage`    | AWS DynamoDB    | `dynamodb`        | `DYNAMODB_ARTICLES_TABLE_NAME`, `AWS_REGION` (+ `DYNAMODB_ENDPOINT` for local) |

## LLM

| Class       | Provider         | `LLM_PROVIDER` | Required env vars                                  |
|-------------|------------------|----------------|----------------------------------------------------|
| `ClaudeLlm` | Anthropic Claude | `claude`       | `ANTHROPIC_API_KEY` (+ optional `CLAUDE_MODEL`)    |
| `GeminiLlm` | Google Gemini    | `gemini`       | `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`)       |
| `OllamaLlm` | Ollama (local)   | `ollama`       | none (+ optional `OLLAMA_BASE_URL`, `OLLAMA_MODEL`)|

`OllamaLlm` calls `POST /api/chat` with a JSON schema in the `format`
field, so the local Ollama server must be **≥ 0.5** for structured
output. Other adapters parse JSON out of free-form responses.

## Scraper

- `InoreaderScraper` — Playwright-based. Collects `unread` or `starred`
  items, fetches full article text via Mozilla Readability, and
  resolves the real `publishedAt` from `<meta>` tags or JSON-LD.
  Persists cookies to `session.json` so subsequent runs skip login.
- `CompositeScraper` — fans out to multiple scrapers when
  `SCRAPER_SOURCE` lists more than one source.

## Tag preference

| Class                    | Storage                                        | When                                       |
|--------------------------|------------------------------------------------|--------------------------------------------|
| `DynamoDbTagPreference`  | DynamoDB table (`DYNAMODB_TAG_PREF_TABLE_NAME`)| Set when `DYNAMODB_TAG_PREF_TABLE_NAME` is non-empty |
| `FileTagPreference`      | `tag-preferences.json` at the project root     | Default — recommended for local dev        |

## Notifier

- `TelegramNotifier` — single rich Telegram message per run (funnel
  counts, importance breakdown, average relevance, top sources, LLM
  call/token usage, duration). Requires `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_CHAT_ID`.

See [DEVELOPMENT.md](../../DEVELOPMENT.md) for end-to-end dev recipes
and the env var reference.
