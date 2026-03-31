import { Component, inject, signal, computed, effect, DestroyRef, HostListener, SecurityContext } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { InboxService, Article } from '../../services/inbox.service';
import { TagPreferenceService } from '../../services/tag-preference.service';
import { AuthService } from '../../services/auth.service';
import { formatDate } from '../../shared/format';
import {
  ImportanceFilter, SortField, SortDirection, COLLAPSED_TAG_LIMIT, PAGE_SIZE,
  applyStructuralFilters, searchAndSort, countByField, countTags,
} from '../../shared/article-list.utils';

type TimeGranularity = 'day' | 'week' | 'month' | 'year';

const IMPORTANCE_TOOLTIP: Record<string, string> = {
  high: 'High importance: breaking news, major announcements, or critical industry changes that require immediate attention',
  medium: 'Medium importance: notable developments, significant updates, or interesting analyses worth reading',
  low: 'Low importance: general news, minor updates, or niche topics with limited broader impact',
};

@Component({
  selector: 'app-inbox',
  imports: [FormsModule],
  templateUrl: './inbox.html',
  styleUrl: './inbox.scss',
})
export class InboxComponent {
  private service = inject(InboxService);
  private prefService = inject(TagPreferenceService);
  private auth = inject(AuthService);
  private sanitizer = inject(DomSanitizer);
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

    // Reset to page 1 whenever filters/search change the result set
    effect(() => {
      this.filteredArticles(); // track dependency
      this.currentPage.set(1);
    }, { allowSignalWrites: true });

    // Auto-focus close button when help modal opens
    effect(() => {
      if (this.showHelp()) {
        setTimeout(() => (document.querySelector('.help-modal button') as HTMLElement)?.focus());
      }
    });
  }

  loading = signal(false);
  deleting = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  articles = signal<Article[]>([]);

  searchQuery = signal('');
  importanceFilter = signal<ImportanceFilter>('all');
  selectedSources = signal<Set<string>>(new Set());
  scraperSourceFilter = signal('all');
  selectedTags = signal<Set<string>>(new Set());
  sortField = signal<SortField>('publishedAt');
  sortDirection = signal<SortDirection>('asc');
  expandedId = signal<string | null>(null);
  selectedIds = signal<Set<string>>(new Set());
  deletingIds = signal<Set<string>>(new Set());
  savingIds = signal<Set<string>>(new Set());
  showAllTags = signal(false);
  showAdvancedFilters = signal(false);
  showHelp = signal(false);
  focusedIndex = signal(-1);
  currentPage = signal(1);
  timeGranularity = signal<TimeGranularity>('day');
  timeFilter = signal<{ start: string; end: string } | null>(null);

  // Tag preference states
  tagStates = signal<Record<string, string>>({});

  // Summary
  summaryHtml = signal('');
  summaryLoading = signal(false);

  // Stats
  totalCount = computed(() => this.articles().length);
  highCount = computed(() => this.articles().filter(a => a.importance === 'high').length);
  mediumCount = computed(() => this.articles().filter(a => a.importance === 'medium').length);
  lowCount = computed(() => this.articles().filter(a => a.importance === 'low').length);

  sourceCountsList = computed(() => countByField(this.articles(), a => a.feedSource));

  uniqueScraperSources = computed(() =>
    [...new Set(this.articles().map(a => a.scraperSource).filter(Boolean))].sort()
  );

  hasActiveAdvancedFilters = computed(() =>
    this.scraperSourceFilter() !== 'all' || this.selectedTags().size > 0
  );

  tagCounts = computed(() => countTags(this.articles()));

  visibleTags = computed(() => {
    const all = this.tagCounts();
    if (this.showAllTags() || all.length <= COLLAPSED_TAG_LIMIT) return all;
    return all.slice(0, COLLAPSED_TAG_LIMIT);
  });

  hiddenTagCount = computed(() => {
    const total = this.tagCounts().length;
    return total > COLLAPSED_TAG_LIMIT ? total - COLLAPSED_TAG_LIMIT : 0;
  });

  topTags = computed(() => this.tagCounts().slice(0, 10));

  maxTagCount = computed(() => {
    const top = this.topTags();
    return top.length > 0 ? top[0].count : 1;
  });

  topSourcesList = computed(() => this.sourceCountsList().slice(0, 5));

  maxSourceCount = computed(() => {
    const s = this.topSourcesList();
    return s.length > 0 ? s[0].count : 1;
  });

  // Parsed dates cache — avoids re-parsing when only granularity changes
  private articleDates = computed(() => {
    const map = new Map<string, Date>();
    for (const a of this.articles()) {
      const d = new Date(a.publishedAt);
      if (!isNaN(d.getTime())) map.set(a.id, d);
    }
    return map;
  });

  // Temporal histogram
  timeBuckets = computed(() => {
    const dates = this.articleDates();
    const granularity = this.timeGranularity();
    const buckets: Record<string, { label: string; count: number; start: string; end: string }> = {};

    for (const [, d] of dates) {

      let key: string;
      let label: string;
      let start: Date;
      let end: Date;

      if (granularity === 'day') {
        key = d.toISOString().slice(0, 10);
        label = key.slice(5); // MM-DD
        start = new Date(key + 'T00:00:00.000Z');
        end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
      } else if (granularity === 'week') {
        const day = new Date(d);
        day.setUTCDate(day.getUTCDate() - day.getUTCDay() + 1);
        key = day.toISOString().slice(0, 10);
        label = 'W' + key.slice(5);
        start = new Date(key + 'T00:00:00.000Z');
        end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
      } else if (granularity === 'month') {
        key = d.toISOString().slice(0, 7);
        label = key;
        start = new Date(key + '-01T00:00:00.000Z');
        end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      } else {
        key = d.getUTCFullYear().toString();
        label = key;
        start = new Date(key + '-01-01T00:00:00.000Z');
        end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 1);
      }

      if (!buckets[key]) {
        buckets[key] = { label, count: 0, start: start.toISOString(), end: end.toISOString() };
      }
      buckets[key].count++;
    }

    return Object.entries(buckets)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => v);
  });

  maxBucketCount = computed(() => {
    const b = this.timeBuckets();
    return b.length > 0 ? Math.max(...b.map(x => x.count)) : 1;
  });

  // Structural filters — only recalculates when filter toggles change, not on search keystrokes
  private structuralFiltered = computed(() =>
    applyStructuralFilters(this.articles(), {
      importance: this.importanceFilter(),
      sources: this.selectedSources(),
      scraperSource: this.scraperSourceFilter(),
      tags: this.selectedTags(),
      timeRange: this.timeFilter(),
    })
  );

  // Search + sort — recalculates on keystroke but skips structural filtering
  filteredArticles = computed(() =>
    searchAndSort(this.structuralFiltered(), this.searchQuery(), this.sortField(), this.sortDirection())
  );

  totalPages = computed(() => Math.max(1, Math.ceil(this.filteredArticles().length / PAGE_SIZE)));

  paginatedArticles = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * PAGE_SIZE;
    return this.filteredArticles().slice(start, start + PAGE_SIZE);
  });

  selectedCount = computed(() => this.selectedIds().size);

  allVisibleSelected = computed(() => {
    const visible = this.paginatedArticles();
    if (visible.length === 0) return false;
    const sel = this.selectedIds();
    return visible.every(a => sel.has(a.id));
  });

  tagBadgeClass(tag: string): string {
    const state = this.tagStates()[tag];
    if (state === 'auto') return 'badge badge-tag-auto';
    if (state === 'filtered') return 'badge badge-tag-filtered';
    return 'badge badge-tag';
  }

  importanceTooltip(level: string): string {
    return IMPORTANCE_TOOLTIP[level] || '';
  }

  // Source filter
  isSourceSelected(source: string): boolean {
    return this.selectedSources().has(source);
  }

  toggleSource(source: string): void {
    this.selectedSources.update(set => {
      const next = new Set(set);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
    this.selectedIds.set(new Set());
  }

  clearSourceFilter(): void {
    this.selectedSources.set(new Set());
    this.selectedIds.set(new Set());
  }

  resetAllFilters(): void {
    this.importanceFilter.set('all');
    this.selectedSources.set(new Set());
    this.scraperSourceFilter.set('all');
    this.selectedTags.set(new Set());
    this.searchQuery.set('');
    this.timeFilter.set(null);
    this.selectedIds.set(new Set());
  }

  hasAnyActiveFilter = computed(() =>
    this.importanceFilter() !== 'all' ||
    this.selectedSources().size > 0 ||
    this.scraperSourceFilter() !== 'all' ||
    this.selectedTags().size > 0 ||
    this.searchQuery().trim() !== '' ||
    this.timeFilter() !== null
  );

  // Tag filter
  isTagSelected(tag: string): boolean {
    return this.selectedTags().has(tag);
  }

  toggleTag(tag: string): void {
    this.selectedTags.update(set => {
      const next = new Set(set);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
    this.selectedIds.set(new Set());
  }

  clearTagFilter(): void {
    this.selectedTags.set(new Set());
    this.selectedIds.set(new Set());
  }

  toggleShowAllTags(): void {
    this.showAllTags.update(v => !v);
  }

  isDeleting(id: string): boolean {
    return this.deletingIds().has(id);
  }

  isSaving(id: string): boolean {
    return this.savingIds().has(id);
  }

  isBusy(id: string): boolean {
    return this.deletingIds().has(id) || this.savingIds().has(id);
  }

  // Selection
  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  toggleSelect(id: string): void {
    this.selectedIds.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleSelectAll(): void {
    if (this.allVisibleSelected()) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(this.paginatedArticles().map(a => a.id)));
    }
  }

  bulkDelete(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} article${ids.length > 1 ? 's' : ''}?`)) return;

    this.deleting.set(true);
    this.error.set(null);
    this.deletingIds.set(new Set(ids));

    this.service.bulkDelete(ids).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        const deletedSet = new Set(ids);
        this.articles.update(list => list.filter(a => !deletedSet.has(a.id)));
        this.selectedIds.set(new Set());
        this.deletingIds.set(new Set());
        if (this.expandedId() && deletedSet.has(this.expandedId()!)) {
          this.expandedId.set(null);
        }
        this.deleting.set(false);
      },
      error: () => {
        this.error.set('Failed to delete articles');
        this.deletingIds.set(new Set());
        this.deleting.set(false);
      },
    });
  }

  saveArticle(article: Article): void {
    if (this.savingIds().has(article.id)) return;

    this.savingIds.update(set => new Set(set).add(article.id));

    this.service.saveArticles([article.id]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.articles.update(list => list.filter(a => a.id !== article.id));
        this.selectedIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
        this.savingIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
        if (this.expandedId() === article.id) this.expandedId.set(null);
      },
      error: () => {
        this.savingIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
        this.error.set(`Failed to save "${article.title}"`);
      },
    });
  }

  bulkSave(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;

    this.saving.set(true);
    this.error.set(null);
    this.savingIds.set(new Set(ids));

    this.service.saveArticles(ids).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        const savedSet = new Set(ids);
        this.articles.update(list => list.filter(a => !savedSet.has(a.id)));
        this.selectedIds.set(new Set());
        this.savingIds.set(new Set());
        if (this.expandedId() && savedSet.has(this.expandedId()!)) {
          this.expandedId.set(null);
        }
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Failed to save articles');
        this.savingIds.set(new Set());
        this.saving.set(false);
      },
    });
  }

  loadInbox(): void {
    this.loading.set(true);
    this.error.set(null);
    this.selectedIds.set(new Set());
    this.summaryHtml.set('');

    this.service.getInbox().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (articles) => {
        this.articles.set(articles);
        this.loading.set(false);
        this.loadTagStates();
      },
      error: (err) => {
        this.error.set(err.status === 401 ? 'Invalid API token' : 'Failed to load inbox');
        this.loading.set(false);
      },
    });
  }

  private loadTagStates(): void {
    const chatId = this.auth.chatId();
    if (!chatId) return;

    this.prefService.getPreferences(chatId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (prefs) => {
        const threshold = prefs.threshold;
        const minRuns = prefs.minRuns;
        const overrides = prefs.tagOverrides ?? {};
        const states: Record<string, string> = {};

        for (const [tag, stats] of Object.entries(prefs.tags)) {
          const override = overrides[tag];
          if (override === 'filtered') {
            states[tag] = 'filtered';
          } else if (override === 'auto' || prefs.scores[tag]?.autoSelected) {
            states[tag] = 'auto';
          }
        }

        this.tagStates.set(states);
      },
      error: () => { /* preferences are optional, ignore errors */ },
    });
  }

  generateSummary(period?: string): void {
    this.summaryLoading.set(true);
    this.error.set(null);

    this.service.generateSummary(period).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.summaryHtml.set(this.sanitizer.sanitize(SecurityContext.HTML, res.html) || '');
        this.summaryLoading.set(false);
      },
      error: () => {
        this.error.set('Failed to generate summary');
        this.summaryLoading.set(false);
      },
    });
  }

  deleteArticle(article: Article): void {
    if (this.deletingIds().has(article.id)) return;
    if (!confirm(`Delete "${article.title}"?`)) return;

    this.deletingIds.update(set => new Set(set).add(article.id));

    this.service.deleteArticle(article.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.articles.update(list => list.filter(a => a.id !== article.id));
        this.selectedIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
        this.deletingIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
        if (this.expandedId() === article.id) this.expandedId.set(null);
      },
      error: () => {
        this.deletingIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
        this.error.set(`Failed to delete "${article.title}"`);
      },
    });
  }

  toggleSort(field: SortField): void {
    if (this.sortField() === field) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('desc');
    }
  }

  toggleExpand(id: string): void {
    this.expandedId.update(current => current === id ? null : id);
  }

  sortIcon(field: SortField): string {
    if (this.sortField() !== field) return '  ';
    return this.sortDirection() === 'asc' ? ' \u25B2' : ' \u25BC';
  }

  // Temporal histogram
  toggleTimeBucket(bucket: { start: string; end: string }): void {
    const current = this.timeFilter();
    if (current && current.start === bucket.start && current.end === bucket.end) {
      this.timeFilter.set(null);
    } else {
      this.timeFilter.set({ start: bucket.start, end: bucket.end });
    }
    this.selectedIds.set(new Set());
  }

  isTimeBucketActive(bucket: { start: string; end: string }): boolean {
    const tf = this.timeFilter();
    return !!tf && tf.start === bucket.start && tf.end === bucket.end;
  }

  clearTimeFilter(): void {
    this.timeFilter.set(null);
  }

  // Keyboard shortcuts
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.showHelp()) {
      if (event.key === 'Escape' || event.key === '?') {
        this.showHelp.set(false);
        event.preventDefault();
      } else if (event.key === 'Tab') {
        this.trapFocusInModal(event);
      }
      return;
    }

    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

    const articles = this.paginatedArticles();
    if (articles.length === 0) return;

    switch (event.key) {
      case '?':
        this.showHelp.set(true);
        event.preventDefault();
        break;
      case 'j':
      case 'ArrowDown':
        this.focusedIndex.update(i => Math.min(i + 1, articles.length - 1));
        this.scrollToFocused();
        event.preventDefault();
        break;
      case 'k':
      case 'ArrowUp':
        this.focusedIndex.update(i => Math.max(i - 1, 0));
        this.scrollToFocused();
        event.preventDefault();
        break;
      case 'x':
        this.toggleFocusedSelect(articles);
        event.preventDefault();
        break;
      case 'Enter':
        this.toggleFocusedExpand(articles);
        event.preventDefault();
        break;
      case 's':
        this.actionFocused(articles, 'save');
        event.preventDefault();
        break;
      case 'd':
        this.actionFocused(articles, 'delete');
        event.preventDefault();
        break;
      case 'r':
        this.resetAllFilters();
        event.preventDefault();
        break;
      case 'Escape':
        this.expandedId.set(null);
        event.preventDefault();
        break;
    }
  }

  private scrollToFocused(): void {
    const idx = this.focusedIndex();
    const row = document.querySelector(`[data-row-index="${idx}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private toggleFocusedSelect(articles: Article[]): void {
    const idx = this.focusedIndex();
    if (idx >= 0 && idx < articles.length) {
      this.toggleSelect(articles[idx].id);
    }
  }

  private toggleFocusedExpand(articles: Article[]): void {
    const idx = this.focusedIndex();
    if (idx >= 0 && idx < articles.length) {
      this.toggleExpand(articles[idx].id);
    }
  }

  private actionFocused(articles: Article[], action: 'save' | 'delete'): void {
    const idx = this.focusedIndex();
    if (idx < 0 || idx >= articles.length) return;
    const article = articles[idx];
    if (action === 'save') {
      this.saveArticle(article);
    } else {
      if (this.deletingIds().has(article.id)) return;
      this.deletingIds.update(set => new Set(set).add(article.id));
      this.service.deleteArticle(article.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.articles.update(list => list.filter(a => a.id !== article.id));
          this.selectedIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
          this.deletingIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
          if (this.expandedId() === article.id) this.expandedId.set(null);
        },
        error: () => {
          this.deletingIds.update(set => { const next = new Set(set); next.delete(article.id); return next; });
          this.error.set(`Failed to delete "${article.title}"`);
        },
      });
    }
  }

  private trapFocusInModal(event: KeyboardEvent): void {
    const modal = document.querySelector('.help-modal');
    if (!modal) return;
    const focusable = modal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  }

  formatDate = formatDate;
}
