import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTagPreference } from './file.tag-preference';

describe('FileTagPreference', () => {
  let tmpDir: string;
  let adapter: FileTagPreference;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tag-pref-'));
    adapter = new FileTagPreference(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null when no preferences exist', async () => {
    const result = await adapter.get('chat123');
    expect(result).toBeNull();
  });

  it('should record selections and normalize tags to lowercase', async () => {
    await adapter.record('chat123', { AI: true, DevOps: false, Security: true });

    const prefs = await adapter.get('chat123');
    expect(prefs).not.toBeNull();
    expect(prefs!.chatId).toBe('chat123');
    expect(prefs!.tags['ai'].selectionCount).toBe(1);
    expect(prefs!.tags['ai'].presentedCount).toBe(1);
    expect(prefs!.tags['ai'].lastSelectedAt).toBeDefined();
    expect(prefs!.tags['devops'].selectionCount).toBe(0);
    expect(prefs!.tags['devops'].presentedCount).toBe(1);
    expect(prefs!.tags['devops'].lastSelectedAt).toBeUndefined();
    expect(prefs!.tags['security'].selectionCount).toBe(1);
    expect(prefs!.tags['security'].presentedCount).toBe(1);
  });

  it('should accumulate counts across multiple records', async () => {
    await adapter.record('chat123', { AI: true, DevOps: false });
    await adapter.record('chat123', { AI: true, DevOps: true });
    await adapter.record('chat123', { AI: false, DevOps: true });

    const prefs = await adapter.get('chat123');
    expect(prefs!.tags['ai'].selectionCount).toBe(2);
    expect(prefs!.tags['ai'].presentedCount).toBe(3);
    expect(prefs!.tags['devops'].selectionCount).toBe(2);
    expect(prefs!.tags['devops'].presentedCount).toBe(3);
  });

  it('should handle new tags appearing in later runs', async () => {
    await adapter.record('chat123', { AI: true });
    await adapter.record('chat123', { AI: true, NewTag: false });

    const prefs = await adapter.get('chat123');
    expect(prefs!.tags['ai'].presentedCount).toBe(2);
    expect(prefs!.tags['newtag'].presentedCount).toBe(1);
    expect(prefs!.tags['newtag'].selectionCount).toBe(0);
  });

  it('should reset preferences', async () => {
    await adapter.record('chat123', { AI: true });
    await adapter.reset('chat123');

    const prefs = await adapter.get('chat123');
    expect(prefs).toBeNull();
  });

  it('should isolate preferences by chatId', async () => {
    await adapter.record('chat1', { AI: true });
    await adapter.record('chat2', { AI: false });

    const prefs1 = await adapter.get('chat1');
    const prefs2 = await adapter.get('chat2');
    expect(prefs1!.tags['ai'].selectionCount).toBe(1);
    expect(prefs2!.tags['ai'].selectionCount).toBe(0);
  });
});
