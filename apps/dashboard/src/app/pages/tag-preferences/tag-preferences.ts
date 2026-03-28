import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TagPreferenceService, TagPreferenceResponse, TagOverride } from '../../services/tag-preference.service';

type TagState = 'auto' | 'filtered' | 'default';
type FilterTab = 'all' | TagState;

interface TagRow {
  name: string;
  selectionCount: number;
  presentedCount: number;
  score: number;
  autoSelected: boolean;
  state: TagState;
  lastSelectedAt?: string;
}

@Component({
  selector: 'app-tag-preferences',
  imports: [FormsModule],
  templateUrl: './tag-preferences.html',
  styleUrl: './tag-preferences.scss',
})
export class TagPreferencesComponent {
  private service = inject(TagPreferenceService);

  apiToken = signal(localStorage.getItem('apiToken') || '');
  chatId = signal(localStorage.getItem('chatId') || '');
  loading = signal(false);
  error = signal<string | null>(null);
  data = signal<TagPreferenceResponse | null>(null);
  activeFilter = signal<FilterTab>('all');
  searchQuery = signal('');

  threshold = computed(() => this.data()?.threshold ?? 0.6);
  minRuns = computed(() => this.data()?.minRuns ?? 3);
  runCount = computed(() => this.data()?.runCount ?? 0);

  allTags = computed<TagRow[]>(() => {
    const d = this.data();
    if (!d) return [];

    const overrides = d.tagOverrides ?? {};

    return Object.entries(d.tags)
      .map(([name, stats]) => {
        const scoreInfo = d.scores[name];
        const override = overrides[name] as TagOverride | undefined;
        let state: TagState = 'default';
        if (override === 'filtered') {
          state = 'filtered';
        } else if (override === 'auto' || scoreInfo?.autoSelected) {
          state = 'auto';
        }
        return {
          name,
          selectionCount: stats.selectionCount,
          presentedCount: stats.presentedCount,
          score: scoreInfo?.score ?? 0,
          autoSelected: scoreInfo?.autoSelected ?? false,
          state,
          lastSelectedAt: stats.lastSelectedAt,
        };
      })
      .sort((a, b) => b.score - a.score);
  });

  tags = computed(() => {
    const filter = this.activeFilter();
    const query = this.searchQuery().toLowerCase().trim();
    let result = this.allTags();
    if (filter !== 'all') result = result.filter(t => t.state === filter);
    if (query) result = result.filter(t => t.name.toLowerCase().includes(query));
    return result;
  });

  autoCount = computed(() => this.allTags().filter(t => t.state === 'auto').length);
  defaultCount = computed(() => this.allTags().filter(t => t.state === 'default').length);
  filteredCount = computed(() => this.allTags().filter(t => t.state === 'filtered').length);

  avgSelectionRate = computed(() => {
    const t = this.allTags();
    if (t.length === 0) return 0;
    return t.reduce((sum, tag) => sum + tag.score, 0) / t.length;
  });

  setFilter(tab: FilterTab): void {
    this.activeFilter.set(tab);
  }

  loadPreferences(): void {
    const id = this.chatId().trim();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);

    this.service.getPreferences(id).subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.status === 401 ? 'Invalid API token' : 'Failed to load preferences');
        this.loading.set(false);
      },
    });
  }

  resetPreferences(): void {
    const id = this.chatId().trim();
    if (!id || !confirm('Reset all tag preferences? This cannot be undone.')) return;

    this.loading.set(true);
    this.service.resetPreferences(id).subscribe({
      next: () => {
        this.data.set(null);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to reset preferences');
        this.loading.set(false);
      },
    });
  }

  changeState(tag: TagRow, newState: string): void {
    const id = this.chatId().trim();
    if (!id) return;

    const override: TagOverride | null = newState === 'default' ? null : newState as TagOverride;

    this.service.setTagOverride(id, tag.name, override).subscribe({
      next: () => this.loadPreferences(),
      error: () => this.error.set(`Failed to update "${tag.name}"`),
    });
  }

  formatScore(score: number): string {
    return `${Math.round(score * 100)}%`;
  }

  formatDate(iso?: string): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  saveToken(token: string): void {
    this.apiToken.set(token);
    localStorage.setItem('apiToken', token);
  }

  saveChatId(id: string): void {
    this.chatId.set(id);
    localStorage.setItem('chatId', id);
  }
}
