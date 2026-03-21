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
- `SCRAPER_SOURCE` (default: `inoreader`)
- `STORAGE_BACKEND` (`google-sheets` or `notion`, default: `google-sheets`)
- `SHOW_BROWSER` (set to `true` to show Playwright browser window)
- `RUN_NOW` (set to `true` to bypass the Paris time window guard)
- `DYNAMODB_TABLE_NAME` (optional for local, see below)

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

> **Note**: In `development` mode (`NODE_ENV=development` in your `.env`), the scraper uses a **local file** (`session-store.json`) instead of AWS DynamoDB to store the session. This allows you to test the entire pipeline without an AWS account.

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

## 5. Working without DynamoDB Locally

If you want to test the `DynamoDbAdapter` locally:
1. **Install DynamoDB Local**: Use Docker: `docker run -p 8000:8000 amazon/dynamodb-local`.
2. **Configure Adapter**: Pass `endpoint: 'http://localhost:8000'` and dummy credentials to the `DynamoDBClient` in your adapter (only for local dev).

---

## 6. Production Configuration (AWS & GitHub)

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

### 6.3 Deployment
Simply push to `main`. The `deploy-lambda` workflow will handle the AWS deployment, and the `scraper` workflow will run twice daily.

---

## 7. Project Architecture Reminder
- **libs/core**: Pure domain logic, models, and port interfaces. No external dependencies.
- **libs/adapters**: Concrete implementations:
  - `scraper/inoreader.adapter.ts` — InoReader scraping via Playwright
  - `storage/google-sheets.adapter.ts` — Google Sheets storage
  - `storage/notion.adapter.ts` — Notion database storage
  - `llm/claude.adapter.ts` / `llm/gemini.adapter.ts` — LLM enrichment
  - `notifier/telegram.adapter.ts` — Telegram notifications
  - `session/dynamodb.adapter.ts` / `session/in-memory-session.adapter.ts` — Session persistence
- **libs/pipeline**: Orchestration (the "Glue") between the ports.
- **apps/**: Entry points (CLI for scraper, Lambda for webhook).
