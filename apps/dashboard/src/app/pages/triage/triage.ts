import { Component, inject, signal, computed, effect, DestroyRef, HostListener } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { InboxService, Article } from '../../services/inbox.service';
import { AuthService } from '../../services/auth.service';
import { formatDate } from '../../shared/format';

@Component({
  selector: 'app-triage',
  imports: [FormsModule],
  templateUrl: './triage.html',
  styleUrl: './triage.scss',
})
export class TriageComponent {
  private service = inject(InboxService);
  private auth = inject(AuthService);
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
  }

  loading = signal(false);
  saving = signal(false);
  skipping = signal(false);
  error = signal<string | null>(null);
  articles = signal<Article[]>([]);
  currentIndex = signal(0);
  showHelp = signal(false);

  savedCount = signal(0);
  skippedCount = signal(0);

  // Track which indices have been actioned (saved or skipped)
  actionedIndices = signal<Set<number>>(new Set());

  currentArticle = computed(() => {
    const list = this.articles();
    const idx = this.currentIndex();
    if (idx < 0 || idx >= list.length) return null;
    return list[idx];
  });

  progress = computed(() => {
    const total = this.articles().length;
    if (total === 0) return '';
    return `${this.currentIndex() + 1} / ${total}`;
  });

  progressPercent = computed(() => {
    const total = this.articles().length;
    if (total === 0) return 0;
    return ((this.currentIndex() + 1) / total) * 100;
  });

  progressStats = computed(() => {
    return `Saved: ${this.savedCount()} · Skipped: ${this.skippedCount()}`;
  });

  done = computed(() => {
    const list = this.articles();
    if (list.length === 0) return false;
    return this.currentIndex() >= list.length;
  });

  canGoPrevious = computed(() => {
    const idx = this.currentIndex();
    if (idx <= 0) return false;
    // Can go back only if the previous article hasn't been actioned
    return !this.actionedIndices().has(idx - 1);
  });

  formatDate = formatDate;

  tagBadgeClass(tag: string): string {
    return 'badge badge-tag';
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    // Don't handle shortcuts when typing in an input
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      return;
    }

    switch (event.key) {
      case 's':
        event.preventDefault();
        this.saveCurrentArticle();
        break;
      case 'd':
        event.preventDefault();
        this.skipCurrentArticle();
        break;
      case 'ArrowRight':
      case 'j':
        event.preventDefault();
        this.passArticle();
        break;
      case 'ArrowLeft':
      case 'k':
        event.preventDefault();
        this.goToPrevious();
        break;
      case '?':
        event.preventDefault();
        this.showHelp.update(v => !v);
        break;
    }
  }

  loadInbox(): void {
    this.loading.set(true);
    this.error.set(null);
    this.currentIndex.set(0);
    this.savedCount.set(0);
    this.skippedCount.set(0);
    this.actionedIndices.set(new Set());

    this.service.getInbox().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (articles) => {
        this.articles.set(articles);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.status === 401 ? 'Invalid API token' : 'Failed to load inbox');
        this.loading.set(false);
      },
    });
  }

  saveCurrentArticle(): void {
    const article = this.currentArticle();
    if (!article || this.saving() || this.skipping()) return;

    this.saving.set(true);
    this.error.set(null);

    this.service.saveArticles([article.id]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.savedCount.update(n => n + 1);
        this.actionedIndices.update(set => new Set(set).add(this.currentIndex()));
        this.saving.set(false);
        this.advanceToNext();
      },
      error: () => {
        this.error.set(`Failed to save "${article.title}"`);
        this.saving.set(false);
      },
    });
  }

  skipCurrentArticle(): void {
    const article = this.currentArticle();
    if (!article || this.saving() || this.skipping()) return;

    this.skipping.set(true);
    this.error.set(null);

    this.service.deleteArticle(article.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.skippedCount.update(n => n + 1);
        this.actionedIndices.update(set => new Set(set).add(this.currentIndex()));
        this.skipping.set(false);
        this.advanceToNext();
      },
      error: () => {
        this.error.set(`Failed to skip "${article.title}"`);
        this.skipping.set(false);
      },
    });
  }

  passArticle(): void {
    if (this.saving() || this.skipping()) return;
    this.advanceToNext();
  }

  goToPrevious(): void {
    if (!this.canGoPrevious()) return;
    this.currentIndex.update(i => i - 1);
  }

  private advanceToNext(): void {
    this.currentIndex.update(i => i + 1);
  }
}
