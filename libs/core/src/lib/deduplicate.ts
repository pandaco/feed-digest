/**
 * Deduplicates articles by URL (ignoring query params) and by title similarity.
 * Keeps the first occurrence (which preserves FIFO order from the scraper).
 */

export interface Deduplicable {
  title: string;
  url: string;
}

/**
 * Extracts the canonical part of a URL: origin + pathname (no query, no hash).
 */
function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return (parsed.origin + parsed.pathname).toLowerCase().replace(/\/+$/, '');
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Tokenizes a title into a set of lowercase words (ignoring short words).
 */
function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

/**
 * Jaccard similarity between two sets: |A ∩ B| / |A ∪ B|.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DeduplicateResult<T> {
  unique: T[];
  duplicates: T[];
}

/**
 * Deduplicates items by URL canonical form and by title similarity (Jaccard).
 * @param items Items to deduplicate
 * @param titleThreshold Jaccard threshold for title similarity (default 0.7)
 * @returns Object with unique items and removed duplicates
 */
export function deduplicate<T extends Deduplicable>(
  items: T[],
  titleThreshold = 0.7,
): DeduplicateResult<T> {
  const seenUrls = new Set<string>();
  const kept: { item: T; tokens: Set<string> }[] = [];
  const duplicates: T[] = [];

  for (const item of items) {
    const canonical = canonicalUrl(item.url);

    if (seenUrls.has(canonical)) {
      duplicates.push(item);
      continue;
    }

    const tokens = tokenize(item.title);
    const isTitleDup = kept.some(
      existing => jaccardSimilarity(existing.tokens, tokens) >= titleThreshold,
    );

    if (isTitleDup) {
      duplicates.push(item);
      continue;
    }

    seenUrls.add(canonical);
    kept.push({ item, tokens });
  }

  return { unique: kept.map(k => k.item), duplicates };
}
