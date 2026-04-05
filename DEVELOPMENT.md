# Development Guide — feed-digest

This guide explains how to set up, run, and test the **feed-digest** project locally, including how to simulate the Telegram webhook without deploying to AWS.

---

## 1. Local Environment Setup

### 1.1 Prerequisites
- **Node.js**: v22 or higher.
- **NX CLI**: Installed globally (`npm install -g nx`) or use `npx nx`.
- **Playwright**: Installed and browsers initialized (for InoreaderAdapter).
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
- If `STORAGE_BACKEND=notion`:
  - `NOTION_API_KEY`
  - `NOTION_INBOX_DB_ID`, `NOTION_ALL_DB_ID`, `NOTION_SAVED_DB_ID`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SCRAPER_SOURCE` (comma-separated: `inoreader` for unread, `inoreader-saved` for starred, e.g. `inoreader,inoreader-saved`)
- `STORAGE_BACKEND` (`google-sheets` or `notion`, default: `google-sheets`)
- `SHOW_BROWSER` (set to `true` to show Playwright browser window)
- `RUN_NOW` (set to `true` to bypass the Paris time window guard)
- `DYNAMODB_TABLE_NAME` (optional for local, see below)
- `DYNAMODB_TAG_PREF_TABLE_NAME` (optional for local, see below)
- `TAG_PREFERENCE_THRESHOLD` (default: `0.6` — minimum score for auto-selection)
- `TAG_PREFERENCE_MIN_RUNS` (default: `3` — minimum presentations before auto-selection kicks in)
- `USER_INTERESTS` (free-text interest profile for LLM relevance scoring, also editable via dashboard)
- `API_PORT` (default: `3333` — port for the local Express API server)

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

## 3. Testing the Webhook Locally (Interactivity)

To test the tag filtering logic on your phone without deploying to AWS and without using Ngrok, we use **Polling mode**. In this mode, your computer actively asks Telegram for new clicks.

### Step 1: Launch the Dev Environment
```bash
npm run webhook
```
This command will start the **Polling Server** (it stays active to listen for your clicks).

### Step 2: Use your phone
1. Wait for the bot to send you the summary.
2. Click on the tag buttons.
3. You will see `[Polling] Received click` in your terminal.
4. Click **"Validate selection"**.
5. Check your storage: the articles will be filtered in real-time!

### Troubleshooting Polling
If you previously configured a Webhook (e.g., via Ngrok or a previous deploy), Polling might be blocked. To reset your bot to a "clean" state, run this command:
```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/deleteWebhook
```

---

## 4. Notion Storage Configuration

If you use `STORAGE_BACKEND=notion`:

### 4.1 Create an integration
1. Go to https://www.notion.so/my-integrations
2. Create a new integration and copy the API key (`NOTION_API_KEY`)

### 4.2 Create the 3 databases
Create 3 Notion databases (Inbox, All, Saved) with the following properties:

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

### 4.3 Share the databases
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

## 5. Tag Preference Learning

The system learns from your tag selections to auto-check your favorite tags in future runs.

**How it works:**
- Each time you validate a tag selection, the system records which tags were selected and which were not. A run counter is incremented on each validation.
- A score is computed for each tag: `selectionCount / presentedCount`.
- When the score exceeds the threshold (`TAG_PREFERENCE_THRESHOLD`, default `0.6`) and the tag has been presented enough times (`TAG_PREFERENCE_MIN_RUNS`, default `3`), the tag is automatically pre-checked in the Telegram keyboard.
- Pre-checked tags appear first in the list, sorted by frequency.
- You can always toggle tags manually before validating.

**Tag overrides:**
Each tag can have a manual override that takes precedence over the score-based logic:
- **`auto`**: the tag is always pre-selected, regardless of its score.
- **`filtered`**: the tag is completely hidden from the Telegram notification keyboard.
- **`default`** (no override): standard threshold-based behavior.

Overrides are managed via the dashboard or the REST API.

**Local development:** preferences are stored in `tag-preferences.json` at the project root.
**Production:** preferences are stored in a dedicated DynamoDB table (`DYNAMODB_TAG_PREF_TABLE_NAME`).

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
- Browse all articles in inbox with title, source, tags, importance, relevance score, and publication date
- Expand any article to view its full summary and metadata
- Filter by importance level, source, tags (multi-select), and free-text search (title + summary + tags with relevance scoring)
- Sort by published date, run date, importance, or relevance score
- Bulk selection (per-article or select-all visible) with bulk delete and bulk save
- Save articles individually or in bulk (moves from inbox to saved)
- Stats overview: article counts by importance, top sources
- Top 10 tags histogram
- AI-generated HTML summary of the entire inbox (via LLM)
- Tags colored by preference state (auto = green, filtered = red, default = purple)
- Tag-based clustering: toggle between list and cluster view, collapsible groups, "Save best + archive rest" batch action, cluster synthesis via LLM
- Snooze articles with presets (ce soir, demain matin, ce weekend, dans 1 semaine)
- "Read" button to open articles in focus mode reader view

**Saved Articles**
- Browse all saved/starred articles with the same filtering and sorting as inbox
- Top 10 tags and top 5 sources histograms
- Filter by importance, source, tags, and free-text search
- Bulk selection with bulk remove
- Expandable detail rows with full summary and metadata
- "Read" button to open articles in focus mode reader view

**Tag Preferences**
- View all tracked tags with their selection scores (progress bars)
- Filter tags by state: All, Auto, Default, Filtered
- Search tags by name
- Change tag state (auto / default / filtered) directly from the table
- See stats: run count, tag counts by state, average selection rate, threshold
- Reset all preferences for a chat ID

**Snoozed**
- View all currently snoozed articles with their snooze expiry date
- Unsnooze articles on demand (returns them to inbox)

**Interests**
- Edit your interest profile as free text (e.g. "web development, AI, security, open source")
- Word count display
- Profile is stored as `.user-interests.txt` and injected into the LLM enrich prompt for relevance scoring

**Reader (Focus Mode)**
- Clean reading view accessible via `/reader/:articleId/:source`
- 70ch max-width typography, optimized line height
- Toggle between article summary and full original content (fetched on demand)
- Reading time estimate based on word count
- Table of contents panel (extracted from article HTML headings)
- Relevance score and tags display
- Direct link to original article

### API Endpoints
The dashboard connects to the webhook Lambda's REST API:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/preferences/:chatId` | Get preferences with computed scores, overrides, and run count |
| `POST` | `/api/preferences/:chatId/tags/:tag/override` | Set a tag override (`{ "override": "auto" \| "filtered" \| null }`) |
| `DELETE` | `/api/preferences/:chatId` | Reset all preferences |
| `GET` | `/api/inbox` | List all articles in inbox |
| `DELETE` | `/api/inbox/:articleId` | Delete a single article from inbox |
| `POST` | `/api/inbox/bulk-delete` | Delete multiple articles (`{ "articleIds": [...] }`) |
| `POST` | `/api/inbox/save` | Save articles (move from inbox to saved) (`{ "articleIds": [...] }`) |
| `POST` | `/api/inbox/summary` | Generate an AI summary of all inbox articles (HTML) |
| `POST` | `/api/inbox/synthesize` | Synthesize selected articles via LLM (`{ "articleIds": [...] }`) |
| `POST` | `/api/inbox/:articleId/snooze` | Snooze an article (`{ "snoozedUntil": "ISO date" }`) |
| `POST` | `/api/inbox/:articleId/unsnooze` | Unsnooze an article |
| `GET` | `/api/inbox/snoozed` | List all snoozed articles |
| `GET` | `/api/saved` | List all saved articles |
| `DELETE` | `/api/saved/:articleId` | Remove a single article from saved |
| `POST` | `/api/saved/bulk-delete` | Remove multiple articles from saved (`{ "articleIds": [...] }`) |
| `GET` | `/api/interests` | Get user interest profile (text) |
| `POST` | `/api/interests` | Save user interest profile (`{ "text": "..." }`) |
| `GET` | `/api/articles/:articleId/content` | Fetch full article content (HTML + word count) |
| `GET` | `/api/articles/:articleId/toc` | Extract table of contents (h2/h3 headings) |

All API calls require the `x-telegram-bot-api-secret-token` header.

---

## 7. Working without DynamoDB Locally

If you want to test the `DynamoDbAdapter` locally:
1. **Install DynamoDB Local**: Use Docker: `docker run -p 8000:8000 amazon/dynamodb-local`.
2. **Configure Adapter**: Pass `endpoint: 'http://localhost:8000'` and dummy credentials to the `DynamoDBClient` in your adapter (only for local dev).

---

## 8. Production Configuration (AWS & GitHub)

### 6.1 AWS SSM Parameters (One-time)
Populate your production secrets in AWS SSM (SecureString):
```bash
# Example for one parameter (repeat for all needed by serverless.yml)
aws ssm put-parameter \
  --name /feed-digest/prod/TELEGRAM_BOT_TOKEN \
  --value "your-token" \
  --type SecureString \
  --region eu-west-1
```

### 6.2 GitHub Secrets
Add these secrets to your GitHub Repository:
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- `INOREADER_EMAIL` / `INOREADER_PASSWORD`
- `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_SHEET_ID` (if Google Sheets)
- `NOTION_API_KEY` / `NOTION_INBOX_DB_ID` / `NOTION_ALL_DB_ID` / `NOTION_SAVED_DB_ID` (if Notion)
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`

### 6.3 GitHub Variables
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

### 6.3 Deployment
Simply push to `main`. The `deploy-lambda` workflow will handle the AWS deployment, and the `scraper` workflow will run five times daily (07h, 10h, 13h, 16h, 19h Paris time — with both winter/summer UTC variants).

---

## 9. Project Architecture Reminder
- **libs/core**: Pure domain logic, models, and port interfaces. No external dependencies.
- **libs/adapters**: Concrete implementations:
  - `scraper/inoreader.adapter.ts` — InoReader scraping via Playwright
  - `storage/google-sheets.adapter.ts` — Google Sheets storage
  - `storage/notion.adapter.ts` — Notion database storage
  - `llm/claude.adapter.ts` / `llm/gemini.adapter.ts` — LLM enrichment
  - `notifier/telegram.adapter.ts` — Telegram notifications
  - `session/dynamodb.adapter.ts` / `session/in-memory-session.adapter.ts` — Session persistence
  - `tag-preference/dynamodb-tag-preference.adapter.ts` / `tag-preference/file-tag-preference.adapter.ts` — Tag preference learning
- **libs/pipeline**: Orchestration (the "Glue") between the ports.
- **apps/scraper**: CLI entry point (composition root).
- **apps/webhook**: AWS Lambda handler for Telegram callbacks + REST API (preferences, inbox, saved, snooze, interests, article content/TOC).
- **apps/dashboard**: Angular web UI: inbox browser (with clustering, snooze, relevance scores), saved articles, triage, tag preferences, snoozed articles, user interests, focus mode reader.
