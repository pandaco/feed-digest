# Setup guide — third-party credentials

This guide is purely about external services: how to create the accounts,
obtain the keys, and grant the right permissions. Everything that
concerns the code itself (commands, env vars, recipes, architecture)
lives in [DEVELOPMENT.md](DEVELOPMENT.md).

---

## 1. Storage backends

### 1.1 Notion (easiest)

1. Create an integration at <https://www.notion.so/my-integrations>.
   Copy the **Internal Integration Token** into `NOTION_API_KEY`.
2. Create **3 empty databases** in any workspace you can share with the
   integration: `Inbox`, `All`, `Saved`. For each one, click `…` →
   `Connections` → add your integration.
3. The database ID is the 32-char hex in the URL:
   ```
   https://www.notion.so/<db-id>?v=…
                          ^^^^^^^^^
   ```
   Copy the IDs into `NOTION_INBOX_DB_ID`, `NOTION_ALL_DB_ID`,
   `NOTION_SAVED_DB_ID`.
4. Run `npm run setup` — it provisions every required property on the
   three databases (idempotent; safe to re-run).

### 1.2 Google Sheets

1. <https://console.cloud.google.com/> → create or select a project.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **IAM & Admin → Service Accounts** → *Create Service Account* → skip
   role assignment → *Done*. Open the account, **Keys** tab, *Add Key →
   Create new key → JSON*. The JSON file downloads automatically.
4. Open the JSON, copy the whole content on **one line** into
   `GOOGLE_SERVICE_ACCOUNT_JSON` (keep the curly braces, escape nothing).
5. Create a Google Sheet, copy the ID from its URL
   (`/spreadsheets/d/<ID>/edit…`) into `GOOGLE_SHEET_ID`.
6. **Share** the sheet with the service account's `client_email`
   (visible in the JSON), grant **Editor**.
7. `npm run setup` creates the required tabs and headers.

### 1.3 DynamoDB

- **Local**: just `docker run -p 8000:8000 amazon/dynamodb-local`.
  `npm run setup` creates the tables. No AWS account required.
- **AWS**: create the tables in the target region (`AWS_REGION`),
  provide credentials via `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
  or any standard AWS credentials chain. `npm run setup` works against
  real AWS too.

---

## 2. LLM providers

Pick **one**; set the matching `LLM_PROVIDER`.

### 2.1 Claude (Anthropic)

1. <https://console.anthropic.com/> → create an account, top up credits.
2. **API Keys** → *Create Key* → copy into `ANTHROPIC_API_KEY`.
3. (Optional) override the default model with `CLAUDE_MODEL`.

### 2.2 Gemini (Google AI Studio)

1. <https://aistudio.google.com/app/apikey> → *Create API Key*.
2. Paste into `GEMINI_API_KEY`. Free tier covers small-volume dev.
3. (Optional) override the default model with `GEMINI_MODEL`.

### 2.3 Ollama (local, no API key)

1. Install: <https://ollama.com/download> (macOS `.dmg`, Linux script,
   Windows installer).
2. Start the server: open the menu-bar app, or `ollama serve &` in a
   terminal. Defaults to `http://localhost:11434`.
3. Pull a model:
   ```bash
   ollama pull llama3.1:8b      # ~5 GB, good default
   ollama pull qwen2.5:7b       # alternative, strong JSON adherence
   ```
4. Nothing to put in `.env` beyond `LLM_PROVIDER=ollama`. Override
   `OLLAMA_BASE_URL` and `OLLAMA_MODEL` only if you diverge from the
   defaults.

> **Ollama requires version ≥ 0.5** because the adapter uses the
> `/api/chat` `format` schema for structured JSON output.

---

## 3. Telegram

Used for the post-run summary and as the dashboard's shared-secret
auth header.

### 3.1 Bot token

1. Open Telegram, talk to **@BotFather**.
2. New bot: `/newbot`, follow the prompts. Existing bot: `/mybots` →
   pick one → *API Token*.
3. Copy the token (`123456:ABC…`) into `TELEGRAM_BOT_TOKEN`.

### 3.2 Personal chat ID

1. Talk to **@userinfobot** (or **@chatIDrobot**), send any message.
2. Copy the numeric `Id` into `TELEGRAM_CHAT_ID`.
3. **Start a chat with your own bot** (`https://t.me/<your-bot-name>` →
   *Start*) so it is allowed to message you.

### 3.3 Shared secret (optional but recommended)

`TELEGRAM_SECRET_TOKEN` is any random string you want. The dashboard
sends it as the `x-telegram-bot-api-secret-token` header on every API
call. Leave empty to disable auth (handy in local dev).

---

## 4. Inoreader

Use your normal login email and password (`INOREADER_EMAIL`,
`INOREADER_PASSWORD`). The scraper drives a real headless browser, so:

- **2FA is not supported.** Disable it on the Inoreader account used
  for scraping, or create a dedicated account.
- The selector targets the *password* sign-in button explicitly, so
  passkey buttons on the login page don't interfere.
- A successful login persists cookies to `session.json` at the project
  root; subsequent runs skip the login flow until the session expires.
