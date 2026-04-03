import { Article } from '../services/inbox.service';

export type ImportanceFilter = 'all' | 'high' | 'medium' | 'low';
export type SortField = 'publishedAt' | 'runAt' | 'importance' | 'relevanceScore';
export type SortDirection = 'asc' | 'desc';

export interface TagWithCount {
  name: string;
  count: number;
}

export const IMPORTANCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export const COLLAPSED_TAG_LIMIT = 8;
export const PAGE_SIZE = 50;

export interface StructuralFilters {
  importance: ImportanceFilter;
  sources: Set<string>;
  scraperSource: string;
  tags: Set<string>;
  timeRange?: { start: string; end: string } | null;
}

export function applyStructuralFilters(articles: Article[], filters: StructuralFilters): Article[] {
  let result = articles;

  if (filters.timeRange) {
    result = result.filter(a => a.publishedAt >= filters.timeRange!.start && a.publishedAt < filters.timeRange!.end);
  }

  if (filters.importance !== 'all') {
    result = result.filter(a => a.importance === filters.importance);
  }

  if (filters.sources.size > 0) {
    result = result.filter(a => filters.sources.has(a.feedSource));
  }

  if (filters.scraperSource !== 'all') {
    result = result.filter(a => a.scraperSource === filters.scraperSource);
  }

  if (filters.tags.size > 0) {
    result = result.filter(a => a.tags.some(t => filters.tags.has(t)));
  }

  return result;
}

function searchScore(article: Article, q: string): number {
  let score = 0;
  if (article.title.toLowerCase().includes(q)) score += 3;
  if (article.tags.some(t => t.toLowerCase().includes(q))) score += 2;
  if (article.summary.toLowerCase().includes(q)) score += 1;
  return score;
}

function compareByField(a: Article, b: Article, field: SortField, dir: number): number {
  if (field === 'importance') {
    return ((IMPORTANCE_RANK[a.importance] || 0) - (IMPORTANCE_RANK[b.importance] || 0)) * dir;
  }
  if (field === 'relevanceScore') {
    return ((a.relevanceScore || 0) - (b.relevanceScore || 0)) * dir;
  }
  return (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * dir;
}

export function searchAndSort(articles: Article[], query: string, field: SortField, direction: SortDirection): Article[] {
  let result = articles;
  const dir = direction === 'asc' ? 1 : -1;

  const q = query.toLowerCase().trim();
  if (q) {
    result = result.filter(a => searchScore(a, q) > 0);

    return [...result].sort((a, b) => {
      const scoreDiff = searchScore(b, q) - searchScore(a, q);
      if (scoreDiff !== 0) return scoreDiff;
      return compareByField(a, b, field, dir);
    });
  }

  return [...result].sort((a, b) => compareByField(a, b, field, dir));
}

export function countByField(articles: Article[], accessor: (a: Article) => string): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const a of articles) {
    const key = accessor(a);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function countTags(articles: Article[]): TagWithCount[] {
  const counts: Record<string, number> = {};
  for (const a of articles) {
    for (const tag of a.tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
