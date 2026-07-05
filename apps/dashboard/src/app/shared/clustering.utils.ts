import { Article } from '../services/inbox.service';
import { ClusterConfig } from '../services/cluster-config.service';

export interface Cluster {
  id: string;
  articles: Article[];
  sharedTags: string[];
  label: string;
}

/**
 * Folds trivial tag variants (case, whitespace, French plurals) so
 * "prévisions météo" and "prévision météo" count as the same tag.
 */
function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map(w => (w.length >= 4 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * Builds a Cluster object from a list of articles.
 */
function buildCluster(articles: Article[]): Cluster {
  // Count by normalized form so plural/case variants pool together,
  // and display each tag's most frequent raw spelling.
  const tagCounts = new Map<string, number>();
  const rawCounts = new Map<string, Map<string, number>>();
  for (const a of articles) {
    for (const t of a.tags) {
      const norm = normalizeTag(t);
      tagCounts.set(norm, (tagCounts.get(norm) || 0) + 1);
      let raws = rawCounts.get(norm);
      if (!raws) {
        raws = new Map();
        rawCounts.set(norm, raws);
      }
      raws.set(t, (raws.get(t) || 0) + 1);
    }
  }
  const displayForm = (norm: string): string =>
    [...rawCounts.get(norm)!.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const sharedTags = [...tagCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([norm]) => displayForm(norm));

  articles.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return {
    // Clusters are disjoint, so the first article id makes the id unique
    // even when two clusters share the same top tags.
    id: `${sharedTags.slice(0, 3).join('-') || 'cluster'}-${articles[0]?.id ?? '0'}`,
    articles,
    sharedTags,
    label: sharedTags.slice(0, 3).join(', ') || 'Related articles',
  };
}

/**
 * Greedy dominant-tag clustering. Repeatedly takes the most frequent tag
 * among unassigned articles and forms a cluster from its articles;
 * oversized groups are narrowed by the most frequent co-occurring tag
 * (also used to honor minSharedTags coherence), then capped to the
 * newest maxArticles. Leftovers stay in the pool for later tags, so
 * coverage stays high: every article whose tag is shared by at least
 * minArticles others ends up in some cluster.
 */
export function clusterArticles(articles: Article[], config: ClusterConfig): Cluster[] {
  if (articles.length === 0) return [];

  const normTags = articles.map(a => [...new Set(a.tags.map(normalizeTag))]);
  const assigned = new Array<boolean>(articles.length).fill(false);
  const clusters: Cluster[] = [];

  function buildBuckets(pool: number[], exclude?: Set<string>): Map<string, number[]> {
    const buckets = new Map<string, number[]>();
    for (const i of pool) {
      if (assigned[i]) continue;
      for (const tag of normTags[i]) {
        if (exclude?.has(tag)) continue;
        let bucket = buckets.get(tag);
        if (!bucket) {
          bucket = [];
          buckets.set(tag, bucket);
        }
        bucket.push(i);
      }
    }
    return buckets;
  }

  function largestBucket(buckets: Map<string, number[]>): { tag: string; indices: number[] } | null {
    let best: { tag: string; indices: number[] } | null = null;
    for (const [tag, indices] of buckets) {
      if (!best || indices.length > best.indices.length) best = { tag, indices };
    }
    return best;
  }

  const byNewest = (a: number, b: number) =>
    new Date(articles[b].publishedAt).getTime() - new Date(articles[a].publishedAt).getTime();

  const allIndices = articles.map((_, i) => i);

  for (;;) {
    const top = largestBucket(buildBuckets(allIndices));
    if (!top || top.indices.length < config.minArticles) break;

    const seed = new Set([top.tag]);
    let current = top.indices;

    // Narrow by co-occurring tags while the group is oversized or the
    // articles don't yet share minSharedTags tags. Each pass grows the
    // seed set, so this terminates.
    while (current.length > config.maxArticles || seed.size < config.minSharedTags) {
      const sub = largestBucket(buildBuckets(current, seed));
      if (!sub || sub.indices.length < config.minArticles) break;
      seed.add(sub.tag);
      current = sub.indices;
    }

    if (current.length > config.maxArticles) {
      current = [...current].sort(byNewest).slice(0, config.maxArticles);
    }
    for (const i of current) assigned[i] = true;
    clusters.push(buildCluster(current.map(i => articles[i])));
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
