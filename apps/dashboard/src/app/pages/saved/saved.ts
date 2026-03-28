import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SavedService } from '../../services/saved.service';
import { Article } from '../../services/inbox.service';
import { formatDate } from '../../shared/format';

type ImportanceFilter = 'all' | 'high' | 'medium' | 'low';
type SortField = 'publishedAt' | 'runAt' | 'importance';
type SortDirection = 'asc' | 'desc';

interface TagWithCount {
  name: string;
  count: number;
}

const IMPORTANCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

const COLLAPSED_TAG_LIMIT = 8;

@Component({
  selector: 'app-saved',
  imports: [FormsModule],
  templateUrl: './saved.html',
  styleUrl: './saved.scss',
})
export class SavedComponent {
  private service = inject(SavedService);

  loading = signal(false);
  deleting = signal(false);
  error = signal<string | null>(null);
  articles = signal<Article[]>([]);

  searchQuery = signal('');
  importanceFilter = signal<ImportanceFilter>('all');
  sourceFilter = signal('all');
  selectedTags = signal<Set<string>>(new Set());
  sortField = signal<SortField>('publishedAt');
  sortDirection = signal<SortDirection>('desc');
  expandedId = signal<string | null>(null);
  selectedIds = signal<Set<string>>(new Set());
  deletingIds = signal<Set<string>>(new Set());
  showAllTags = signal(false);

  // Stats
  totalCount = computed(() => this.articles().length);
  highCount = computed(() => this.articles().filter(a => a.importance === 'high').length);
  mediumCount = computed(() => this.articles().filter(a => a.importance === 'medium').length);
  lowCount = computed(() => this.articles().filter(a => a.importance === 'low').length);

  uniqueSources = computed(() =>
    [...new Set(this.articles().map(a => a.feedSource))].sort()
  );

  sourceCounts = computed(() => {
    const counts: Record<string, number> = {};
    for (const a of this.articles()) {
      counts[a.feedSource] = (counts[a.feedSource] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  });

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

  tagCounts = computed<TagWithCount[]>(() => {
    const counts: Record<string, number> = {};
    for (const a of this.articles()) {
      for (const tag of a.tags) {
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  });

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

  filteredArticles = computed(() => {
    let result = this.articles();

    const importance = this.importanceFilter();
    if (importance !== 'all') {
      result = result.filter(a => a.importance === importance);
    }

    const source = this.sourceFilter();
    if (source !== 'all') {
      result = result.filter(a => a.feedSource === source);
    }

    const tags = this.selectedTags();
    if (tags.size > 0) {
      result = result.filter(a => a.tags.some(t => tags.has(t)));
    }

    const query = this.searchQuery().toLowerCase().trim();
    if (query) {
      result = result.filter(a =>
        a.title.toLowerCase().includes(query) ||
        a.summary.toLowerCase().includes(query)
      );
    }

    const field = this.sortField();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;
    result = [...result].sort((a, b) => {
      if (field === 'importance') {
        return ((IMPORTANCE_RANK[a.importance] || 0) - (IMPORTANCE_RANK[b.importance] || 0)) * dir;
      }
      return (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * dir;
    });

    return result;
  });

  selectedCount = computed(() => this.selectedIds().size);

  allVisibleSelected = computed(() => {
    const visible = this.filteredArticles();
    if (visible.length === 0) return false;
    const sel = this.selectedIds();
    return visible.every(a => sel.has(a.id));
  });

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
      this.selectedIds.set(new Set(this.filteredArticles().map(a => a.id)));
    }
  }

  bulkDelete(): void {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} article${ids.length > 1 ? 's' : ''} from saved?`)) return;

    this.deleting.set(true);
    this.error.set(null);
    this.deletingIds.set(new Set(ids));

    this.service.bulkDelete(ids).subscribe({
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

    this.service.getSaved().subscribe({
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
    if (!confirm(`Remove "${article.title}" from saved?`)) return;

    this.deletingIds.update(set => new Set(set).add(article.id));

    this.service.deleteArticle(article.id).subscribe({
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
