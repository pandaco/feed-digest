import { LlmPort, StoragePort, TagPreferencePort } from '@feed-digest/core';
import { GoogleSheetsAdapter } from './storage/google-sheets.adapter';
import { NotionAdapter } from './storage/notion.adapter';
import { DynamoDbStorageAdapter } from './storage/dynamodb-storage.adapter';
import { ClaudeAdapter } from './llm/claude.adapter';
import { GeminiAdapter } from './llm/gemini.adapter';
import { DynamoDbTagPreferenceAdapter } from './tag-preference/dynamodb-tag-preference.adapter';
import { FileTagPreferenceAdapter } from './tag-preference/file-tag-preference.adapter';

export function createStorage(label = 'App'): StoragePort {
  const backend = process.env['STORAGE_BACKEND'] || 'google-sheets';
  switch (backend) {
    case 'google-sheets':
      return new GoogleSheetsAdapter({
        spreadsheetId: process.env['GOOGLE_SHEET_ID']!,
        serviceAccountJson: process.env['GOOGLE_SERVICE_ACCOUNT_JSON']!,
      });
    case 'notion':
      return new NotionAdapter({
        apiKey: process.env['NOTION_API_KEY']!,
        inboxDatabaseId: process.env['NOTION_INBOX_DB_ID']!,
        allDatabaseId: process.env['NOTION_ALL_DB_ID']!,
        savedDatabaseId: process.env['NOTION_SAVED_DB_ID']!,
      });
    case 'dynamodb':
      return new DynamoDbStorageAdapter({
        region: process.env['AWS_REGION'] || 'eu-west-1',
        tableName: process.env['DYNAMODB_ARTICLES_TABLE_NAME']!,
        endpoint: process.env['DYNAMODB_ENDPOINT'],
      });
    default:
      throw new Error(`[${label}] Unknown STORAGE_BACKEND: "${backend}". Supported: google-sheets, notion, dynamodb`);
  }
}

export function createLlm(label = 'App'): { llm: LlmPort; provider: 'claude' | 'gemini' } {
  const provider = (process.env['LLM_PROVIDER'] || 'claude') as 'claude' | 'gemini';
  switch (provider) {
    case 'gemini':
      return { llm: new GeminiAdapter(process.env['GEMINI_API_KEY']!, process.env['GEMINI_MODEL']), provider };
    case 'claude':
      return { llm: new ClaudeAdapter(process.env['ANTHROPIC_API_KEY']!, process.env['CLAUDE_MODEL']), provider };
    default:
      throw new Error(`[${label}] Unknown LLM_PROVIDER: "${provider}". Supported: claude, gemini`);
  }
}

export function createTagPreference(): TagPreferencePort {
  return process.env['NODE_ENV'] === 'development'
    ? new FileTagPreferenceAdapter()
    : new DynamoDbTagPreferenceAdapter({
        region: process.env['AWS_REGION'] || 'eu-west-1',
        tableName: process.env['DYNAMODB_TAG_PREF_TABLE_NAME']!,
      });
}
