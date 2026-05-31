import { LlmPort, LlmProvider, StoragePort, TagPreferencePort } from '@feed-digest/core';
import { GoogleSheetsStorage } from './storage/google-sheets.storage';
import { NotionStorage } from './storage/notion.storage';
import { DynamoDbStorage } from './storage/dynamodb.storage';
import { ClaudeLlm } from './llm/claude.llm';
import { GeminiLlm } from './llm/gemini.llm';
import { OllamaLlm } from './llm/ollama.llm';
import { DynamoDbTagPreference } from './tag-preference/dynamodb.tag-preference';
import { FileTagPreference } from './tag-preference/file.tag-preference';

export function createStorage(label = 'App'): StoragePort {
  const backend = process.env['STORAGE_BACKEND'] || 'google-sheets';
  switch (backend) {
    case 'google-sheets':
      return new GoogleSheetsStorage({
        spreadsheetId: process.env['GOOGLE_SHEET_ID']!,
        serviceAccountJson: process.env['GOOGLE_SERVICE_ACCOUNT_JSON']!,
      });
    case 'notion':
      return new NotionStorage({
        apiKey: process.env['NOTION_API_KEY']!,
        inboxDatabaseId: process.env['NOTION_INBOX_DB_ID']!,
        allDatabaseId: process.env['NOTION_ALL_DB_ID']!,
        savedDatabaseId: process.env['NOTION_SAVED_DB_ID']!,
      });
    case 'dynamodb':
      return new DynamoDbStorage({
        region: process.env['AWS_REGION'] || 'eu-central-1',
        tableName: process.env['DYNAMODB_ARTICLES_TABLE_NAME']!,
        endpoint: process.env['DYNAMODB_ENDPOINT'],
      });
    default:
      throw new Error(`[${label}] Unknown STORAGE_BACKEND: "${backend}". Supported: google-sheets, notion, dynamodb`);
  }
}

export function createLlm(label = 'App'): { llm: LlmPort; provider: LlmProvider } {
  const provider = (process.env['LLM_PROVIDER'] || 'claude') as LlmProvider;
  switch (provider) {
    case 'gemini':
      return { llm: new GeminiLlm(process.env['GEMINI_API_KEY']!, process.env['GEMINI_MODEL']), provider };
    case 'claude':
      return { llm: new ClaudeLlm(process.env['ANTHROPIC_API_KEY']!, process.env['CLAUDE_MODEL']), provider };
    case 'ollama':
      return { llm: new OllamaLlm(process.env['OLLAMA_BASE_URL'], process.env['OLLAMA_MODEL']), provider };
    default:
      throw new Error(`[${label}] Unknown LLM_PROVIDER: "${provider}". Supported: claude, gemini, ollama`);
  }
}

export function createTagPreference(): TagPreferencePort {
  const table = process.env['DYNAMODB_TAG_PREF_TABLE_NAME'];
  return table
    ? new DynamoDbTagPreference({
        region: process.env['AWS_REGION'] || 'eu-central-1',
        tableName: table,
      })
    : new FileTagPreference();
}
