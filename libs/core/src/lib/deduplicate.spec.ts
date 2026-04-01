import { describe, it, expect } from 'vitest';
import { deduplicate } from './deduplicate';

const item = (title: string, url: string) => ({ title, url });

describe('deduplicate', () => {
  it('should remove exact URL duplicates (ignoring query params)', () => {
    const items = [
      item('Article One', 'https://example.com/post/1'),
      item('Article Two', 'https://example.com/post/1?utm_source=rss'),
    ];
    const result = deduplicate(items);
    expect(result.unique).toHaveLength(1);
    expect(result.unique[0].title).toBe('Article One');
    expect(result.duplicates).toHaveLength(1);
  });

  it('should remove duplicates with similar titles', () => {
    const items = [
      item('OpenAI launches new GPT-5 model for developers', 'https://a.com/1'),
      item('OpenAI launches new GPT-5 model for enterprise developers', 'https://b.com/2'),
    ];
    const result = deduplicate(items);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it('should keep articles with different titles', () => {
    const items = [
      item('React 20 released with new compiler', 'https://a.com/1'),
      item('Rust 2.0 brings async improvements', 'https://b.com/2'),
    ];
    const result = deduplicate(items);
    expect(result.unique).toHaveLength(2);
    expect(result.duplicates).toHaveLength(0);
  });

  it('should handle trailing slashes in URLs', () => {
    const items = [
      item('Post', 'https://example.com/post/'),
      item('Post copy', 'https://example.com/post'),
    ];
    const result = deduplicate(items);
    expect(result.unique).toHaveLength(1);
  });

  it('should return empty for empty input', () => {
    const result = deduplicate([]);
    expect(result.unique).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
  });

  it('should keep first occurrence (FIFO order)', () => {
    const items = [
      item('Breaking news about AI', 'https://a.com/1'),
      item('Breaking news about AI', 'https://b.com/2'),
    ];
    const result = deduplicate(items);
    expect(result.unique[0].url).toBe('https://a.com/1');
  });

  it('should respect custom title threshold', () => {
    const items = [
      item('OpenAI launches new GPT model today', 'https://a.com/1'),
      item('OpenAI launches new GPT model this week', 'https://b.com/2'),
    ];
    // With very high threshold, these should NOT be considered duplicates
    const strict = deduplicate(items, 0.99);
    expect(strict.unique).toHaveLength(2);

    // With lower threshold they should be duplicates (high overlap)
    const relaxed = deduplicate(items, 0.5);
    expect(relaxed.unique).toHaveLength(1);
  });
});
