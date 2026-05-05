import { Article } from '../services/inbox.service';

export interface Cluster {
  id: string;
  articles: Article[];
  sharedTags: string[];
  label: string;
}

const MAX_CLUSTER_SIZE = 50;

/**
 * Union-find clustering: articles sharing >= minShared tags are merged.
 * Returns raw groups (arrays of articles), including singletons.
 */
function unionFindGroups(articles: Article[], minShared: number): Article[][] {
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

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const shared = articles[i].tags.filter(t => articles[j].tags.includes(t));
      if (shared.length >= minShared) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < articles.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  return [...groups.values()].map(indices => indices.map(i => articles[i]));
}

/**
 * Builds a Cluster object from a list of articles.
 */
function buildCluster(articles: Article[]): Cluster {
  const tagCounts = new Map<string, number>();
  for (const a of articles) {
    for (const t of a.tags) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  const sharedTags = [...tagCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  articles.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return {
    id: sharedTags.join('-') || `cluster-${articles[0]?.id ?? '0'}`,
    articles,
    sharedTags,
    label: sharedTags.slice(0, 3).join(', ') || 'Related articles',
  };
}

/**
 * Groups articles that share >= 2 tags using union-find.
 * Large clusters (> MAX_CLUSTER_SIZE) are recursively split
 * by raising the minimum shared tag threshold.
 */
export function clusterArticles(articles: Article[]): Cluster[] {
  if (articles.length === 0) return [];

  const clusters: Cluster[] = [];

  function splitGroup(group: Article[], minShared: number): void {
    if (group.length < 5) return;

    // If group is small enough or we can't split further, emit it
    if (group.length <= MAX_CLUSTER_SIZE || minShared > 5) {
      clusters.push(buildCluster(group));
      return;
    }

    // Try splitting with a higher threshold
    const subGroups = unionFindGroups(group, minShared + 1);
    const multiGroups = subGroups.filter(g => g.length >= 5);

    if (multiGroups.length <= 1) {
      // Higher threshold didn't split — accept as-is
      clusters.push(buildCluster(group));
      return;
    }

    // Recursively process sub-groups
    for (const sub of multiGroups) {
      splitGroup(sub, minShared + 1);
    }
  }

  // Initial pass with minShared = 2
  const initialGroups = unionFindGroups(articles, 2);
  for (const group of initialGroups) {
    if (group.length < 5) continue;
    splitGroup(group, 2);
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
