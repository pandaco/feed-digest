import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTagPreferenceAdapter } from './file-tag-preference.adapter';

describe('FileTagPreferenceAdapter', () => {
  let tmpDir: string;
  let adapter: FileTagPreferenceAdapter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tag-pref-'));
    adapter = new FileTagPreferenceAdapter(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null when no preferences exist', async () => {
    const result = await adapter.get('chat123');
    expect(result).toBeNull();
  });

  it('should record selections and increment counts', async () => {
    await adapter.record('chat123', { AI: true, DevOps: false, Security: true });

    const prefs = await adapter.get('chat123');
    expect(prefs).not.toBeNull();
    expect(prefs!.chatId).toBe('chat123');
    expect(prefs!.tags['AI'].selectionCount).toBe(1);
    expect(prefs!.tags['AI'].presentedCount).toBe(1);
    expect(prefs!.tags['AI'].lastSelectedAt).toBeDefined();
    expect(prefs!.tags['DevOps'].selectionCount).toBe(0);
    expect(prefs!.tags['DevOps'].presentedCount).toBe(1);
    expect(prefs!.tags['DevOps'].lastSelectedAt).toBeUndefined();
    expect(prefs!.tags['Security'].selectionCount).toBe(1);
    expect(prefs!.tags['Security'].presentedCount).toBe(1);
  });

  it('should accumulate counts across multiple records', async () => {
    await adapter.record('chat123', { AI: true, DevOps: false });
    await adapter.record('chat123', { AI: true, DevOps: true });
    await adapter.record('chat123', { AI: false, DevOps: true });

    const prefs = await adapter.get('chat123');
    expect(prefs!.tags['AI'].selectionCount).toBe(2);
    expect(prefs!.tags['AI'].presentedCount).toBe(3);
    expect(prefs!.tags['DevOps'].selectionCount).toBe(2);
    expect(prefs!.tags['DevOps'].presentedCount).toBe(3);
  });

  it('should handle new tags appearing in later runs', async () => {
    await adapter.record('chat123', { AI: true });
    await adapter.record('chat123', { AI: true, NewTag: false });

    const prefs = await adapter.get('chat123');
    expect(prefs!.tags['AI'].presentedCount).toBe(2);
    expect(prefs!.tags['NewTag'].presentedCount).toBe(1);
    expect(prefs!.tags['NewTag'].selectionCount).toBe(0);
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
    expect(prefs1!.tags['AI'].selectionCount).toBe(1);
    expect(prefs2!.tags['AI'].selectionCount).toBe(0);
  });
});
