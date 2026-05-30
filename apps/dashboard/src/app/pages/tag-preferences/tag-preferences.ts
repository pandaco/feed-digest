import { Component, inject, signal, computed, effect, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TagPreferenceService, TagPreferenceResponse, TagOverride } from '../../services/tag-preference.service';
import { AuthService } from '../../services/auth.service';
import { formatDate, formatScore } from '../../shared/format';

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
  protected auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private errorTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const err = this.error();
      clearTimeout(this.errorTimer);
      if (err) {
        this.errorTimer = setTimeout(() => this.error.set(null), 8000);
      }
    });

    this.loadPreferences();
  }

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
    const id = this.auth.chatId().trim();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);

    this.service.getPreferences(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    const id = this.auth.chatId().trim();
    if (!id || !confirm('Reset all tag preferences? This cannot be undone.')) return;

    this.loading.set(true);
    this.service.resetPreferences(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    const id = this.auth.chatId().trim();
    if (!id) return;

    const override: TagOverride | null = newState === 'default' ? null : newState as TagOverride;

    this.service.setTagOverride(id, tag.name, override).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.loadPreferences(),
      error: () => this.error.set(`Failed to update "${tag.name}"`),
    });
  }

  formatScore = formatScore;
  formatDate = formatDate;
}
