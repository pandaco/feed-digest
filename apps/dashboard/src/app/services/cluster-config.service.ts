import { Injectable, signal } from '@angular/core';

export interface ClusterConfig {
  minSharedTags: number;
  minArticles: number;
  maxArticles: number;
}

const DEFAULT_CONFIG: ClusterConfig = {
  minSharedTags: 3,
  minArticles: 5,
  maxArticles: 50,
};

const STORAGE_KEY = 'feed_digest_cluster_config';

@Injectable({ providedIn: 'root' })
export class ClusterConfigService {
  config = signal<ClusterConfig>(this.loadConfig());

  private loadConfig(): ClusterConfig {
    const saved = localStorage.getItem(STORAGE_KEY);
    return this.sanitize(saved ? JSON.parse(saved) : DEFAULT_CONFIG);
  }

  updateConfig(newConfig: ClusterConfig): void {
    const config = this.sanitize(newConfig);
    this.config.set(config);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  // The number inputs can emit null (cleared field) or 0; clustering needs
  // sane bounds (maxArticles 0 would make the greedy loop spin forever).
  private sanitize(config: ClusterConfig): ClusterConfig {
    const minSharedTags = Math.max(1, Math.floor(config.minSharedTags) || DEFAULT_CONFIG.minSharedTags);
    const minArticles = Math.max(2, Math.floor(config.minArticles) || DEFAULT_CONFIG.minArticles);
    const maxArticles = Math.max(minArticles, Math.floor(config.maxArticles) || DEFAULT_CONFIG.maxArticles);
    return { minSharedTags, minArticles, maxArticles };
  }
}
