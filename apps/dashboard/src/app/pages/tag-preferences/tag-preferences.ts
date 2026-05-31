import { Component, inject, signal, computed, effect, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TagPreferenceService, TagPreferenceResponse, TagOverride } from '../../services/tag-preference.service';
import { AuthService } from '../../services/auth.service';
import { formatDate, formatScore } from '../../shared/format';

type TagState = 'auto' | 'filtered' | 'default';
type FilterTab = 'all' | TagState;
type SortColumn = 'name' | 'score' | 'selectionCount' | 'presentedCount' | 'state';
type SortDir = 'asc' | 'desc';

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

    effect(() => {
      if (this.auth.chatId().trim() && !this.data() && !this.loading()) {
        this.loadPreferences();
      }
    });
  }

  loading = signal(false);
  error = signal<string | null>(null);
  data = signal<TagPreferenceResponse | null>(null);
  activeFilter = signal<FilterTab>('all');
  searchQuery = signal('');
  sortColumn = signal<SortColumn>('score');
  sortDir = signal<SortDir>('desc');

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
  });

  tags = computed(() => {
    const filter = this.activeFilter();
    const query = this.searchQuery().toLowerCase().trim();
    const col = this.sortColumn();
    const dir = this.sortDir();
    let result = this.allTags();
    if (filter !== 'all') result = result.filter(t => t.state === filter);
    if (query) result = result.filter(t => t.name.toLowerCase().includes(query));
    return [...result].sort((a, b) => {
      let cmp = 0;
      if (col === 'name') cmp = a.name.localeCompare(b.name);
      else if (col === 'score') cmp = a.score - b.score;
      else if (col === 'selectionCount') cmp = a.selectionCount - b.selectionCount;
      else if (col === 'presentedCount') cmp = a.presentedCount - b.presentedCount;
      else if (col === 'state') cmp = a.state.localeCompare(b.state);
      return dir === 'asc' ? cmp : -cmp;
    });
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

  toggleSort(col: SortColumn): void {
    if (this.sortColumn() === col) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(col);
      this.sortDir.set(col === 'name' || col === 'state' ? 'asc' : 'desc');
    }
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
