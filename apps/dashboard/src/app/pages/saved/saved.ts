import { Component, inject, signal, computed, effect, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SavedService } from '../../services/saved.service';
import { Article } from '../../services/inbox.service';
import { formatDate } from '../../shared/format';
import {
  ImportanceFilter, SortField, SortDirection, COLLAPSED_TAG_LIMIT, PAGE_SIZE,
  applyStructuralFilters, searchAndSort, countByField, countTags,
} from '../../shared/article-list.utils';

@Component({
  selector: 'app-saved',
  imports: [FormsModule, RouterLink],
  templateUrl: './saved.html',
  styleUrl: './saved.scss',
})
export class SavedComponent {
  private service = inject(SavedService);
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
      this.filteredArticles();
      this.currentPage.set(1);
    }, { allowSignalWrites: true });

    this.loadSaved();
  }

  loading = signal(false);
  deleting = signal(false);
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
  showAllTags = signal(false);
  showAdvancedFilters = signal(false);
  currentPage = signal(1);

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

  sourceCounts = computed(() => this.sourceCountsList().slice(0, 5));

  topSources = computed(() =>
    this.sourceCounts()
      .slice(0, 3)
      .map(s => `${s.name} (${s.count})`)
      .join(', ')
  );

  maxSourceCount = computed(() => {
    const sc = this.sourceCounts();
    return sc.length > 0 ? sc[0].count : 1;
  });

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

  // Structural filters — only recalculates when filter toggles change, not on search keystrokes
  private structuralFiltered = computed(() =>
    applyStructuralFilters(this.articles(), {
      importance: this.importanceFilter(),
      sources: this.selectedSources(),
      scraperSource: this.scraperSourceFilter(),
      tags: this.selectedTags(),
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
        this.error.set('Failed to remove articles');
        this.deletingIds.set(new Set());
        this.deleting.set(false);
      },
    });
  }

  loadSaved(): void {
    this.loading.set(true);
    this.error.set(null);
    this.selectedIds.set(new Set());

    this.service.getSaved().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (articles) => {
        this.articles.set(articles);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.status === 401 ? 'Invalid API token' : 'Failed to load saved articles');
        this.loading.set(false);
      },
    });
  }

  deleteArticle(article: Article): void {
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
        this.error.set(`Failed to remove "${article.title}"`);
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

  formatDate = formatDate;
}
