import { describe, it, expect } from 'vitest';
import { normalizeTag, normalizeTags } from './normalize-tags';

describe('normalizeTag', () => {
  it('should lowercase and trim a tag', () => {
    expect(normalizeTag('  Machine Learning  ')).toBe('machine learning');
  });

  it('should handle already lowercase tags', () => {
    expect(normalizeTag('react')).toBe('react');
  });

  it('should handle mixed case', () => {
    expect(normalizeTag('TypeScript')).toBe('typescript');
  });
});

describe('normalizeTags', () => {
  it('should normalize and deduplicate tags', () => {
    expect(normalizeTags(['React', 'react', 'REACT'])).toEqual(['react']);
  });

  it('should preserve order of first occurrence', () => {
    expect(normalizeTags(['AI', 'react', 'ai'])).toEqual(['ai', 'react']);
  });

  it('should filter out empty strings after trim', () => {
    expect(normalizeTags(['  ', 'react', ''])).toEqual(['react']);
  });

  it('should return empty array for empty input', () => {
    expect(normalizeTags([])).toEqual([]);
  });
});
