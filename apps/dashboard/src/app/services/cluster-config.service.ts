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
    return saved ? JSON.parse(saved) : DEFAULT_CONFIG;
  }

  updateConfig(newConfig: ClusterConfig): void {
    this.config.set(newConfig);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
  }
}
