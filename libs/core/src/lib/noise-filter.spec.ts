import { describe, it, expect } from 'vitest';
import { filterNoise } from './noise-filter';

const item = (title: string, url: string, excerpt: string) => ({ title, url, excerpt });

describe('filterNoise', () => {
  it('should filter articles with too-short excerpts', () => {
    const items = [
      item('Good article', 'https://a.com/1', 'A'.repeat(150)),
      item('Short one', 'https://b.com/2', 'Hi'),
    ];
    const result = filterNoise(items);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].title).toBe('Good article');
    expect(result.noise).toHaveLength(1);
  });

  it('should filter articles with blacklisted title patterns', () => {
    const items = [
      item('Sponsored: Best VPN 2026', 'https://a.com/1', 'A'.repeat(200)),
      item('Real article about security', 'https://b.com/2', 'A'.repeat(200)),
    ];
    const result = filterNoise(items);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].title).toBe('Real article about security');
  });

  it('should filter articles from blacklisted domains', () => {
    const items = [
      item('Article', 'https://spam.example.com/post', 'A'.repeat(200)),
      item('Article', 'https://legit.com/post', 'A'.repeat(200)),
    ];
    const result = filterNoise(items, { domainBlacklist: ['spam.example.com'] });
    expect(result.kept).toHaveLength(1);
    expect(result.noise).toHaveLength(1);
  });

  it('should use custom minimum content length', () => {
    const items = [item('Short', 'https://a.com/1', 'A'.repeat(50))];
    const lenient = filterNoise(items, { minContentLength: 30 });
    expect(lenient.kept).toHaveLength(1);

    const strict = filterNoise(items, { minContentLength: 100 });
    expect(strict.kept).toHaveLength(0);
  });

  it('should handle empty input', () => {
    const result = filterNoise([]);
    expect(result.kept).toHaveLength(0);
    expect(result.noise).toHaveLength(0);
  });

  it('should use custom title blacklist', () => {
    const items = [
      item('PROMO: save 50%', 'https://a.com/1', 'A'.repeat(200)),
    ];
    const result = filterNoise(items, { titleBlacklist: ['promo'] });
    expect(result.noise).toHaveLength(1);
  });
});
