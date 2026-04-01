/**
 * Normalizes a single tag: lowercase + trim.
 * Ensures consistent tag comparison across the entire pipeline.
 */
export function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim();
}

/**
 * Normalizes and deduplicates an array of tags.
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}
