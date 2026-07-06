import { Article } from '../services/inbox.service';
import { ClusterConfig } from '../services/cluster-config.service';

export interface Cluster {
  id: string;
  articles: Article[];
  sharedTags: string[];
  label: string;
}

type TagNormalizer = (tag: string) => string;

/**
 * Builds a tag normalizer for one clustering pass. Case/whitespace variants
 * always fold; a trailing 's' (French plural) folds ONLY when the singular
 * form also appears in the article set, so tags that merely end in 's'
 * ("paris", "temps") don't collapse into unrelated words.
 *
 * Note: this folding is display/grouping-only and intentionally looser than
 * the canonical normalizeTag in @feed-digest/core (lowercase + trim), which
 * defines tag identity for preference scoring.
 */
function createTagNormalizer(articles: Article[]): TagNormalizer {
  const vocab = new Set<string>();
  for (const a of articles) {
    for (const t of a.tags) {
      for (const w of t.toLowerCase().trim().split(/\s+/)) vocab.add(w);
    }
  }

  const cache = new Map<string, string>();
  return (tag: string): string => {
    let norm = cache.get(tag);
    if (norm === undefined) {
      norm = tag
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .map(w => (w.length >= 4 && w.endsWith('s') && vocab.has(w.slice(0, -1)) ? w.slice(0, -1) : w))
        .join(' ');
      cache.set(tag, norm);
    }
    return norm;
  };
}

/**
 * Builds a Cluster object from a list of articles.
 */
function buildCluster(articles: Article[], normalize: TagNormalizer): Cluster {
  // Count by normalized form so plural/case variants pool together,
  // and display each tag's most frequent raw spelling.
  const tagCounts = new Map<string, number>();
  const rawCounts = new Map<string, Map<string, number>>();
  for (const a of articles) {
    for (const t of a.tags) {
      const norm = normalize(t);
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
 * oversized groups are narrowed by the most frequent co-occurring tag,
 * then capped to the newest maxArticles. A dominant tag whose group can't
 * reach minSharedTags shared tags is retired instead of emitted, so every
 * emitted cluster honors the configured coherence bound. Leftovers stay in
 * the pool for later tags, so coverage stays high.
 */
export function clusterArticles(articles: Article[], config: ClusterConfig): Cluster[] {
  if (articles.length === 0) return [];

  // Guard against unvalidated config (cleared/0 inputs): maxArticles of 0
  // would otherwise loop forever below since no article ever gets assigned,
  // and minArticles of 1 floods the view with singleton "clusters".
  const minSharedTags = Math.max(1, Math.floor(config.minSharedTags) || 1);
  const minArticles = Math.max(2, Math.floor(config.minArticles) || 2);
  const maxArticles = Math.max(minArticles, Math.floor(config.maxArticles) || 50);

  const normalize = createTagNormalizer(articles);
  const normTags = articles.map(a => [...new Set(a.tags.map(normalize))]);
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
  // Dominant tags that couldn't reach minSharedTags coherence — retired so
  // the loop makes progress and their articles can cluster under other tags.
  const rejected = new Set<string>();

  for (;;) {
    const top = largestBucket(buildBuckets(allIndices, rejected));
    if (!top || top.indices.length < minArticles) break;

    const seed = new Set([top.tag]);
    let current = top.indices;

    // Narrow by co-occurring tags while the group is oversized or the
    // articles don't yet share minSharedTags tags. Each pass grows the
    // seed set, so this terminates.
    while (current.length > maxArticles || seed.size < minSharedTags) {
      const sub = largestBucket(buildBuckets(current, seed));
      if (!sub || sub.indices.length < minArticles) break;
      seed.add(sub.tag);
      current = sub.indices;
    }

    if (seed.size < minSharedTags) {
      rejected.add(top.tag);
      continue;
    }

    if (current.length > maxArticles) {
      current = [...current].sort(byNewest).slice(0, maxArticles);
    }
    for (const i of current) assigned[i] = true;
    clusters.push(buildCluster(current.map(i => articles[i]), normalize));
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
