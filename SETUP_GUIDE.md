# 🛠 Configuration Guide — step-by-step

This guide explains in detail how to find each parameter needed for the `.env` file.

---

## 1. Google Sheets Integration

### 1.1 Finding your Google Sheet ID
1. Open your Google Spreadsheet in your browser.
2. Look at the URL in the address bar.
3. The ID is the long string of characters between `/d/` and `/edit`.
   - URL: `https://docs.google.com/spreadsheets/d/1A_B_C_123_XYZ/edit#gid=0`
   - **Sheet ID**: `1A_B_C_123_XYZ`

### 1.2 Creating a Service Account (JSON)
To allow the script to write to your sheet without manual login:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new **Project** (e.g., "Inoreader Digest").
3. Go to **APIs & Services** > **Library** and search for **"Google Sheets API"**. Click **Enable**.
4. Go to **IAM & Admin** > **Service Accounts**.
5. Click **"Create Service Account"**. Give it a name and click **"Create and Continue"**.
6. (Optional) Skip roles for now. Click **"Done"**.
7. In the list, click on your new service account's email.
8. Go to the **"Keys"** tab.
9. Click **"Add Key"** > **"Create new key"** > **JSON**.
10. A file will download to your computer. Open it with a text editor.
11. **IMPORTANT**: Copy the entire content and put it in your `.env` for `GOOGLE_SERVICE_ACCOUNT_JSON`. It must be on one single line.

### 1.3 Sharing the Sheet
For the script to have permission to write:
1. Open your Google Sheet.
2. Click **Share** (top right).
3. Copy the `client_email` address from your service account JSON (it looks like `account-name@project-id.iam.gserviceaccount.com`).
4. Paste it into the "Share" field and give it **Editor** permissions.

---

## 2. LLM Providers (AI)

### 2.1 Claude (Anthropic)
1. Go to [Anthropic Console](https://console.anthropic.com/).
2. Create an account and add credits (if needed).
3. Go to **API Keys** and click **"Create Key"**.

### 2.2 Gemini (Google AI Studio)
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click **"Create API Key"**.
3. It's often free for limited use!

---

## 3. Telegram Bot

### 3.1 Obtaining the API Token
The **API Token** is the key that allows the application to control the bot.
- **If you don't have a bot yet**:
  1. Search for **@BotFather** on Telegram.
  2. Send `/newbot` and follow the instructions.
  3. At the end, @BotFather will give you the token (e.g., `123456:ABC-DEF`).
- **If you already have a bot**:
  1. Search for **@BotFather** in your Telegram conversations.
  2. Send `/mybots`.
  3. Click on the name of the bot you want to use.
  4. Click on **API Token**.
  5. The token will be displayed (e.g., `123456:ABC-DEF`).

### 3.2 Finding your Personal Chat ID
The **Chat ID** is the unique number of *your* account. This allows the bot to know who to send the messages to.
1. Search for **@userinfobot** or **@chatIDrobot** on Telegram.
2. Send any message to it (like "Hello").
3. It will reply with your **Id** (a number like `123456789`).
   - Copy this number for `TELEGRAM_CHAT_ID`.

### 3.3 Starting the Bot
**Crucial Step**: Before the bot can send you messages, you must initiate the conversation with it.
1. Go to the URL of your bot (e.g., `https://t.me/your_bot_name`).
2. Click on **Start** (or send `/start`).

---

## 4. InoReader
1. Use your standard login email and password.
2. Note: If you have 2FA (Two-Factor Authentication) enabled on Inoreader, you might need to disable it or create an app password if available (currently scraping assumes no 2FA).

---

## 5. Summary Table for .env

| Variable | Source | Example |
|---|---|---|
| `INOREADER_EMAIL` | Your Inoreader account | `me@email.com` |
| `LLM_PROVIDER` | Choose `claude` or `gemini` | `claude` |
| `GOOGLE_SHEET_ID` | Spreadsheet URL | `1_ABC_..._XYZ` |
| `TELEGRAM_CHAT_ID` | @userinfobot on Telegram | `123456789` |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram | `123456:ABC-DEF` |
| `DYNAMODB_TAG_PREF_TABLE_NAME` | AWS DynamoDB table name | `feed-digest-tag-prefs` |
| `TAG_PREFERENCE_THRESHOLD` | Auto-selection score threshold | `0.6` |
| `TAG_PREFERENCE_MIN_RUNS` | Minimum runs before auto-selection | `3` |
| `USER_INTERESTS` | Free-text interest profile for relevance scoring | `web dev, AI, security` |
| `API_PORT` | Local dashboard API port | `3333` |
