import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InboxService, Article } from '../../services/inbox.service';
import { ToastService } from '../../services/toast.service';
import { formatDate } from '../../shared/format';
import { formatSnoozeDate } from '../../shared/snooze.utils';

@Component({
  selector: 'app-snoozed',
  templateUrl: './snoozed.html',
  styleUrl: './snoozed.scss',
})
export class SnoozedComponent {
  private service = inject(InboxService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    this.loadSnoozed();
  }

  loading = signal(false);
  error = signal<string | null>(null);
  articles = signal<Article[]>([]);
  unsnoozing = signal<Set<string>>(new Set());
  expandedId = signal<string | null>(null);

  totalCount = computed(() => this.articles().length);

  loadSnoozed(): void {
    this.loading.set(true);
    this.error.set(null);

    this.service.getSnoozed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (articles) => {
        this.articles.set(articles.sort((a, b) => (a.snoozedUntil || '').localeCompare(b.snoozedUntil || '')));
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.status === 401 ? 'Invalid API token' : 'Failed to load snoozed articles');
        this.loading.set(false);
      },
    });
  }

  unsnooze(article: Article): void {
    if (this.unsnoozing().has(article.id)) return;

    this.unsnoozing.update(set => new Set(set).add(article.id));

    this.service.unsnoozeArticle(article.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.articles.update(list => list.filter(a => a.id !== article.id));
        this.unsnoozing.update(set => { const next = new Set(set); next.delete(article.id); return next; });
      },
      error: () => {
        this.unsnoozing.update(set => { const next = new Set(set); next.delete(article.id); return next; });
        this.toast.error(`Failed to unsnooze "${article.title}"`);
      },
    });
  }

  toggleExpand(id: string): void {
    this.expandedId.update(current => current === id ? null : id);
  }

  isUnsnoozing(id: string): boolean {
    return this.unsnoozing().has(id);
  }

  formatDate = formatDate;
  formatSnoozeDate = formatSnoozeDate;
}
