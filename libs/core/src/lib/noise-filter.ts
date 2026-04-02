/**
 * Heuristic noise filter to detect articles that are too short, empty,
 * or match advertising patterns. Applied before LLM enrichment to save API calls.
 */

export interface NoiseFilterConfig {
  /** Minimum content length in characters (default: 100) */
  minContentLength?: number;
  /** Patterns in titles that indicate ads/spam (case-insensitive) */
  titleBlacklist?: string[];
  /** Domain blacklist — articles from these domains are auto-archived */
  domainBlacklist?: string[];
}

export interface Filterable {
  title: string;
  url: string;
  excerpt: string;
}

export interface NoiseFilterResult<T> {
  kept: T[];
  noise: T[];
}

const DEFAULT_TITLE_BLACKLIST = [
  'sponsored',
  'publicité',
  'advertorial',
  'advertisement',
  'promoted content',
  'partenaire',
  'partner content',
];

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Filters out noise articles using heuristic rules (zero LLM cost).
 */
export function filterNoise<T extends Filterable>(
  items: T[],
  config: NoiseFilterConfig = {},
): NoiseFilterResult<T> {
  const minLength = config.minContentLength ?? 100;
  const titleBlacklist = (config.titleBlacklist ?? DEFAULT_TITLE_BLACKLIST).map(p => p.toLowerCase());
  const domainBlacklist = new Set((config.domainBlacklist ?? []).map(d => d.toLowerCase()));

  const kept: T[] = [];
  const noise: T[] = [];

  for (const item of items) {
    const titleLower = item.title.toLowerCase();
    const domain = extractDomain(item.url);

    const isTitleBlacklisted = titleBlacklist.some(pattern => titleLower.includes(pattern));
    const isDomainBlacklisted = domainBlacklist.size > 0 && domainBlacklist.has(domain);
    const isTooShort = item.excerpt.trim().length > 0 && item.excerpt.trim().length < minLength;

    if (isTitleBlacklisted || isDomainBlacklisted || isTooShort) {
      noise.push(item);
    } else {
      kept.push(item);
    }
  }

  return { kept, noise };
}
