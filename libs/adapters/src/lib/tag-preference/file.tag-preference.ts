import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TagOverride, TagPreference, TagPreferencePort, normalizeTag } from '@feed-digest/core';

export class FileTagPreference implements TagPreferencePort {
  private readonly filePath: string;

  constructor(dir: string = process.cwd()) {
    this.filePath = join(dir, 'tag-preferences.json');
  }

  private readStore(): Record<string, TagPreference> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private writeStore(store: Record<string, TagPreference>): void {
    writeFileSync(this.filePath, JSON.stringify(store, null, 2));
  }

  async record(chatId: string, selections: Record<string, boolean>): Promise<void> {
    const store = this.readStore();
    const existing = store[chatId];
    const tags = existing?.tags ?? {};
    const now = new Date().toISOString();

    for (const [rawTag, selected] of Object.entries(selections)) {
      const tag = normalizeTag(rawTag);
      if (!tags[tag]) {
        tags[tag] = { selectionCount: 0, presentedCount: 0 };
      }
      tags[tag].presentedCount++;
      if (selected) {
        tags[tag].selectionCount++;
        tags[tag].lastSelectedAt = now;
      }
    }

    const runCount = (existing?.runCount ?? 0) + 1;
    store[chatId] = { chatId, tags, tagOverrides: existing?.tagOverrides, runCount };
    this.writeStore(store);
    console.log(`[FileTagPref] Preferences recorded locally for chatId: ${chatId} (run #${runCount})`);
  }

  async get(chatId: string): Promise<TagPreference | null> {
    const store = this.readStore();
    return store[chatId] ?? null;
  }

  async reset(chatId: string): Promise<void> {
    const store = this.readStore();
    delete store[chatId];
    this.writeStore(store);
    console.log(`[FileTagPref] Preferences reset locally for chatId: ${chatId}`);
  }

  async setTagOverride(chatId: string, rawTag: string, override: TagOverride | null): Promise<void> {
    const store = this.readStore();
    const existing = store[chatId];
    if (!existing) return;

    const tag = normalizeTag(rawTag);
    const overrides = existing.tagOverrides ?? {};
    if (override === null) {
      delete overrides[tag];
    } else {
      overrides[tag] = override;
    }

    existing.tagOverrides = overrides;
    this.writeStore(store);
    console.log(`[FileTagPref] Tag "${tag}" override set to ${override ?? 'default'} for chatId: ${chatId}`);
  }
}
