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

    effect(() => {
      if (this.showHelp()) {
        setTimeout(() => (document.querySelector('.help-modal button') as HTMLElement)?.focus());
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
  speedMode = signal(false);

  savedCount = signal(0);
  skippedCount = signal(0);

  // Track which indices have been actioned (saved or skipped)
  actionedIndices = signal<Set<number>>(new Set());

  // Undo stack: stores last action so it can be reversed
  private undoStack = signal<{ index: number; action: 'saved' | 'skipped'; articleId: string }[]>([]);

  // Timing: track when triage started and decisions made
  private triageStartedAt = 0;
  private decisionCount = signal(0);

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
    const parts = [`Saved: ${this.savedCount()}`, `Skipped: ${this.skippedCount()}`];
    const avg = this.avgTimePerDecision();
    if (avg) parts.push(`Avg: ${avg}s`);
    return parts.join(' · ');
  });

  avgTimePerDecision = computed(() => {
    const count = this.decisionCount();
    if (count === 0 || this.triageStartedAt === 0) return null;
    const elapsed = (Date.now() - this.triageStartedAt) / 1000;
    return Math.round(elapsed / count);
  });

  canUndo = computed(() => this.undoStack().length > 0);

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tagBadgeClass(_tag: string): string {
    return 'badge badge-tag';
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    if (this.showHelp()) {
      if (event.key === 'Escape' || event.key === '?') {
        this.showHelp.set(false);
        event.preventDefault();
      } else if (event.key === 'Tab') {
        this.trapFocusInModal(event);
      }
      return;
    }

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
      case 'z':
        event.preventDefault();
        this.undoLastAction();
        break;
      case 'm':
        event.preventDefault();
        this.speedMode.update(v => !v);
        break;
      case '?':
        event.preventDefault();
        this.showHelp.update(v => !v);
        break;
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

  loadInbox(): void {
    this.loading.set(true);
    this.error.set(null);
    this.currentIndex.set(0);
    this.savedCount.set(0);
    this.skippedCount.set(0);
    this.actionedIndices.set(new Set());
    this.undoStack.set([]);
    this.decisionCount.set(0);
    this.triageStartedAt = Date.now();

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

    const idx = this.currentIndex();
    this.service.saveArticles([article.id]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.savedCount.update(n => n + 1);
        this.decisionCount.update(n => n + 1);
        this.actionedIndices.update(set => new Set(set).add(idx));
        this.undoStack.update(stack => [...stack, { index: idx, action: 'saved', articleId: article.id }]);
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

    const idx = this.currentIndex();
    this.service.deleteArticle(article.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.skippedCount.update(n => n + 1);
        this.decisionCount.update(n => n + 1);
        this.actionedIndices.update(set => new Set(set).add(idx));
        this.undoStack.update(stack => [...stack, { index: idx, action: 'skipped', articleId: article.id }]);
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

  undoLastAction(): void {
    const stack = this.undoStack();
    if (stack.length === 0 || this.saving() || this.skipping()) return;

    const last = stack[stack.length - 1];
    this.undoStack.update(s => s.slice(0, -1));

    // Revert counters
    if (last.action === 'saved') {
      this.savedCount.update(n => Math.max(0, n - 1));
    } else {
      this.skippedCount.update(n => Math.max(0, n - 1));
    }
    this.decisionCount.update(n => Math.max(0, n - 1));

    // Remove from actioned set
    this.actionedIndices.update(set => {
      const next = new Set(set);
      next.delete(last.index);
      return next;
    });

    // Navigate back to that article
    this.currentIndex.set(last.index);
  }

  private advanceToNext(): void {
    this.currentIndex.update(i => i + 1);
  }
}
