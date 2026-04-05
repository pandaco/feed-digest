/**
 * One-shot script to create all required properties in Notion databases.
 * Safe to run multiple times — existing properties are left unchanged.
 *
 * Usage: npx tsx --tsconfig tsconfig.base.json apps/scraper/src/setup-notion.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

const REQUIRED_PROPERTIES: Record<string, any> = {
  'Article ID':         { rich_text: {} },
  'Run At':             { rich_text: {} },
  'Published At':       { rich_text: {} },
  'Source':             { rich_text: {} },
  'URL':                { url: {} },
  'Tags':               { rich_text: {} },
  'Summary':            { rich_text: {} },
  'Importance':         { rich_text: {} },
  'Content Unavailable':{ checkbox: {} },
  'LLM Provider':       { rich_text: {} },
  'Summary Language':   { rich_text: {} },
  'Scraper Source':     { rich_text: {} },
  'Snoozed Until':      { rich_text: {} },
  'Relevance Score':    { number: { format: 'number' } },
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

async function setupDatabase(apiKey: string, databaseId: string, label: string): Promise<void> {
  console.log(`\n[setup-notion] Fetching schema for ${label} (${databaseId})...`);

  const db = await notionFetch(`databases/${databaseId}`, 'GET', apiKey);
  const existing = new Set(Object.keys(db.properties ?? {}));

  const toCreate: Record<string, any> = {};
  for (const [name, def] of Object.entries(REQUIRED_PROPERTIES)) {
    if (existing.has(name)) {
      console.log(`  ✅ "${name}" already exists`);
    } else {
      console.log(`  ➕ "${name}" will be created`);
      toCreate[name] = def;
    }
  }

  if (Object.keys(toCreate).length === 0) {
    console.log(`  → Nothing to do for ${label}.`);
    return;
  }

  await notionFetch(`databases/${databaseId}`, 'PATCH', apiKey, { properties: toCreate });
  console.log(`  ✓ ${label} updated with ${Object.keys(toCreate).length} new propert${Object.keys(toCreate).length === 1 ? 'y' : 'ies'}.`);
}

async function main(): Promise<void> {
  const apiKey = process.env['NOTION_API_KEY'];
  const inboxId = process.env['NOTION_INBOX_DB_ID'];
  const allId = process.env['NOTION_ALL_DB_ID'];
  const savedId = process.env['NOTION_SAVED_DB_ID'];

  if (!apiKey || !inboxId || !allId || !savedId) {
    console.error('[setup-notion] Missing env vars: NOTION_API_KEY, NOTION_INBOX_DB_ID, NOTION_ALL_DB_ID, NOTION_SAVED_DB_ID');
    process.exit(1);
  }

  await setupDatabase(apiKey, inboxId, 'Inbox');
  await setupDatabase(apiKey, allId, 'All');
  await setupDatabase(apiKey, savedId, 'Saved');

  console.log('\n[setup-notion] Done.');
}

main().catch(err => {
  console.error('[setup-notion] Failed:', err.message);
  process.exit(1);
});
