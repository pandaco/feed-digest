import { Article } from '../services/inbox.service';

export interface Cluster {
  id: string;
  articles: Article[];
  sharedTags: string[];
  label: string;
}

/**
 * Groups articles that share >= 2 tags.
 * Uses a greedy union-find approach: for each pair of articles sharing >= 2 tags,
 * merge them into the same cluster.
 */
export function clusterArticles(articles: Article[]): Cluster[] {
  if (articles.length === 0) return [];

  // parent map for union-find
  const parent = new Map<number, number>();
  for (let i = 0; i < articles.length; i++) parent.set(i, i);

  function find(x: number): number {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Union articles sharing >= 2 tags
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const shared = articles[i].tags.filter(t => articles[j].tags.includes(t));
      if (shared.length >= 2) {
        union(i, j);
      }
    }
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < articles.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  // Build clusters (only groups with > 1 article)
  const clusters: Cluster[] = [];
  for (const [, indices] of groups) {
    if (indices.length < 2) continue;

    const clusterArticles = indices.map(i => articles[i]);

    // Find tags shared by at least 2 articles in the cluster
    const tagCounts = new Map<string, number>();
    for (const a of clusterArticles) {
      for (const t of a.tags) {
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }
    const sharedTags = [...tagCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);

    clusters.push({
      id: sharedTags.join('-') || `cluster-${indices[0]}`,
      articles: clusterArticles,
      sharedTags,
      label: sharedTags.slice(0, 3).join(', ') || 'Related articles',
    });
  }

  return clusters.sort((a, b) => b.articles.length - a.articles.length);
}

/**
 * Returns articles that are NOT in any cluster.
 */
export function getUnclusteredArticles(articles: Article[], clusters: Cluster[]): Article[] {
  const clusteredIds = new Set<string>();
  for (const c of clusters) {
    for (const a of c.articles) {
      clusteredIds.add(a.id);
    }
  }
  return articles.filter(a => !clusteredIds.has(a.id));
}
