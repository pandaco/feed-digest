/**
 * One-shot setup script for storage backends.
 * Provisions the schema (tabs/columns/properties) for the configured backend.
 * Safe to run multiple times — existing structure is left unchanged.
 *
 * Usage: npm run setup
 */
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

const NOTION_REQUIRED_PROPERTIES: Record<string, any> = {
  'Article ID':          { rich_text: {} },
  'Run At':              { rich_text: {} },
  'Published At':        { rich_text: {} },
  'Source':              { rich_text: {} },
  'URL':                 { url: {} },
  'Tags':                { rich_text: {} },
  'Summary':             { rich_text: {} },
  'Importance':          { rich_text: {} },
  'Content Unavailable': { checkbox: {} },
  'LLM Provider':        { rich_text: {} },
  'Summary Language':    { rich_text: {} },
  'Scraper Source':      { rich_text: {} },
  'Snoozed Until':       { rich_text: {} },
  'Relevance Score':     { number: { format: 'number' } },
};

async function notionFetch(path: string, method: string, apiKey: string, body?: any): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  return res.json();
}

async function setupNotionDatabase(apiKey: string, databaseId: string, label: string): Promise<void> {
  console.log(`\n[setup] Fetching Notion schema for ${label} (${databaseId})...`);

  const db = await notionFetch(`databases/${databaseId}`, 'GET', apiKey);
  const existingProps = db.properties ?? {};

  const toUpdate: Record<string, any> = {};
  for (const [name, def] of Object.entries(NOTION_REQUIRED_PROPERTIES)) {
    const existing = existingProps[name];
    const expectedType = Object.keys(def)[0];

    if (!existing) {
      console.log(`  ➕ "${name}" will be created (${expectedType})`);
      toUpdate[name] = def;
    } else if (existing.type !== expectedType) {
      console.log(`  ⚠️  "${name}" exists as "${existing.type}" but expected "${expectedType}" — will update`);
      toUpdate[name] = def;
    } else {
      console.log(`  ✅ "${name}" (${expectedType})`);
    }
  }

  if (Object.keys(toUpdate).length === 0) {
    console.log(`  → Nothing to do for ${label}.`);
    return;
  }

  await notionFetch(`databases/${databaseId}`, 'PATCH', apiKey, { properties: toUpdate });
  const count = Object.keys(toUpdate).length;
  console.log(`  ✓ ${label} updated (${count} propert${count === 1 ? 'y' : 'ies'} created/fixed).`);
}

async function setupNotion(): Promise<void> {
  const apiKey  = process.env['NOTION_API_KEY'];
  const inboxId = process.env['NOTION_INBOX_DB_ID'];
  const allId   = process.env['NOTION_ALL_DB_ID'];
  const savedId = process.env['NOTION_SAVED_DB_ID'];

  if (!apiKey || !inboxId || !allId || !savedId) {
    console.error('[setup] Missing Notion env vars: NOTION_API_KEY, NOTION_INBOX_DB_ID, NOTION_ALL_DB_ID, NOTION_SAVED_DB_ID');
    process.exit(1);
  }

  await setupNotionDatabase(apiKey, inboxId, 'Inbox');
  await setupNotionDatabase(apiKey, allId, 'All');
  await setupNotionDatabase(apiKey, savedId, 'Saved');
}

// ---------------------------------------------------------------------------
// Google Sheets
// ---------------------------------------------------------------------------

const SHEETS_HEADERS = [
  'ID', 'Run At', 'Published At', 'Source', 'Title', 'URL', 'Tags',
  'Summary', 'Importance', 'Content Unavailable', 'LLM Provider', 'Summary Language',
  'Scraper Source', 'Snoozed Until', 'Relevance Score',
];

async function setupGoogleSheets(): Promise<void> {
  const serviceAccountJson = process.env['GOOGLE_SERVICE_ACCOUNT_JSON'];
  const spreadsheetId      = process.env['GOOGLE_SHEET_ID'];

  if (!serviceAccountJson || !spreadsheetId) {
    console.error('[setup] Missing Google Sheets env vars: GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(serviceAccountJson),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTabs = new Set(spreadsheet.data.sheets?.map(s => s.properties?.title) ?? []);
  const requiredTabs = ['Inbox', 'All', 'Saved'];

  const missingTabs = requiredTabs.filter(tab => !existingTabs.has(tab));
  if (missingTabs.length > 0) {
    console.log(`\n[setup] Creating missing tabs: ${missingTabs.join(', ')}`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missingTabs.map(tab => ({ addSheet: { properties: { title: tab } } })) },
    });
  }

  for (const tab of requiredTabs) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:Z1` });
    const firstRow = res.data.values?.[0] ?? [];
    const missingCols = SHEETS_HEADERS.filter(h => !firstRow.includes(h));

    if (firstRow.length === 0) {
      console.log(`\n[setup] Tab "${tab}" is empty — writing headers...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [SHEETS_HEADERS] },
      });
      console.log(`  ✓ Headers written.`);
    } else if (missingCols.length > 0) {
      // Rewrite the full header row in the correct order (adapter reads by index)
      console.log(`\n[setup] Tab "${tab}" — missing column(s): ${missingCols.join(', ')} — rewriting header row in correct order`);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [SHEETS_HEADERS] },
      });
      console.log(`  ✓ Header row updated.`);
    } else {
      console.log(`\n[setup] Tab "${tab}" — all columns present ✅`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const backend = process.env['STORAGE_BACKEND'] ?? 'google-sheets';
  console.log(`[setup] Storage backend: ${backend}`);

  if (backend === 'notion') {
    await setupNotion();
  } else {
    await setupGoogleSheets();
  }

  console.log('\n[setup] Done.');
}

main().catch(err => {
  console.error('[setup] Failed:', err.message);
  process.exit(1);
});
