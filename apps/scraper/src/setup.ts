/**
 * One-shot setup script for storage backends.
 * Provisions the schema (tabs/columns/properties/tables) for the configured backend.
 * Safe to run multiple times — existing structure is left unchanged.
 *
 * Usage: npm run setup
 */
import * as dotenv from 'dotenv';
import { google } from 'googleapis';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  DescribeTimeToLiveCommand
} from '@aws-sdk/client-dynamodb';

dotenv.config();

// ---------------------------------------------------------------------------
// DynamoDB
// ---------------------------------------------------------------------------

async function setupDynamoDb(): Promise<void> {
  const region = process.env['AWS_REGION'] || 'eu-central-1';
  const endpoint = process.env['DYNAMODB_ENDPOINT'];
  const articlesTable = process.env['DYNAMODB_ARTICLES_TABLE_NAME'];
  const tagPrefsTable = process.env['DYNAMODB_TAG_PREF_TABLE_NAME'];

  if (!articlesTable || !tagPrefsTable) {
    console.error('[setup] Missing DynamoDB env vars: DYNAMODB_ARTICLES_TABLE_NAME, DYNAMODB_TAG_PREF_TABLE_NAME');
    process.exit(1);
  }

  const client = new DynamoDBClient({
    region,
    ...(endpoint ? { endpoint } : {}),
  });

  console.log(`\n[setup] Provisioning DynamoDB tables (Region: ${region}${endpoint ? `, Endpoint: ${endpoint}` : ''})...`);

  // 1. Articles Table
  try {
    await client.send(new DescribeTableCommand({ TableName: articlesTable }));
    console.log(`  ✅ Articles table "${articlesTable}" already exists.`);

    // Ensure TTL is enabled even if table already existed
    const ttl = await client.send(new DescribeTimeToLiveCommand({ TableName: articlesTable }));
    if (ttl.TimeToLiveDescription?.TimeToLiveStatus !== 'ENABLED') {
      console.log(`  ⏳ Enabling TTL on "expiresAt" attribute for existing table...`);
      await client.send(new UpdateTimeToLiveCommand({
        TableName: articlesTable,
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      }));
      console.log(`  ✓ TTL update requested.`);
    } else {
      console.log(`  ✅ TTL is already enabled on "expiresAt".`);
    }

  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException' || err.__type?.endsWith('ResourceNotFoundException')) {
      console.log(`  ➕ Creating articles table "${articlesTable}"...`);
      await client.send(new CreateTableCommand({
        TableName: articlesTable,
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [{
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        }],
        BillingMode: 'PAY_PER_REQUEST',
      }));
      console.log(`  ✓ Articles table created.`);

      // Enable TTL on new table
      console.log(`  ⏳ Enabling TTL on "expiresAt" attribute...`);
      await client.send(new UpdateTimeToLiveCommand({
        TableName: articlesTable,
        TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      }));
      console.log(`  ✓ TTL enabled.`);
    } else {
      throw err;
    }
  }

  // 2. Tag Preferences Table
  try {
    await client.send(new DescribeTableCommand({ TableName: tagPrefsTable }));
    console.log(`  ✅ Tag preferences table "${tagPrefsTable}" already exists.`);
  } catch (err: any) {
    if (err.name === 'ResourceNotFoundException' || err.__type?.endsWith('ResourceNotFoundException')) {
      console.log(`  ➕ Creating tag preferences table "${tagPrefsTable}"...`);
      await client.send(new CreateTableCommand({
        TableName: tagPrefsTable,
        AttributeDefinitions: [{ AttributeName: 'chatId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'chatId', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
      }));
      console.log(`  ✓ Tag preferences table created.`);
    } else {
      throw err;
    }
  }
}

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
  } else if (backend === 'dynamodb') {
    await setupDynamoDb();
  } else {
    await setupGoogleSheets();
  }

  console.log('\n[setup] Done.');
}

main().catch(err => {
  console.error('[setup] Failed:', err.message);
  process.exit(1);
});
