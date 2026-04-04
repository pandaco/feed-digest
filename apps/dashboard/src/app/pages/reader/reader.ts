import { Component, inject, signal, computed, DestroyRef, SecurityContext } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { InboxService, Article } from '../../services/inbox.service';
import { SavedService } from '../../services/saved.service';
import { formatDate, estimateReadingTime } from '../../shared/format';

@Component({
  selector: 'app-reader',
  imports: [RouterLink],
  templateUrl: './reader.html',
  styleUrl: './reader.scss',
})
export class ReaderComponent {
  private inboxService = inject(InboxService);
  private savedService = inject(SavedService);
  private sanitizer = inject(DomSanitizer);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  article = signal<Article | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  showFullContent = signal(false);
  fullContent = signal('');
  fullContentLoading = signal(false);
  fullContentWordCount = signal(0);

  readingTime = computed(() => {
    if (this.showFullContent() && this.fullContent()) {
      return estimateReadingTime(this.fullContent().replace(/<[^>]*>/g, ' '));
    }
    const a = this.article();
    return a ? estimateReadingTime(a.summary) : '';
  });

  source = signal<'inbox' | 'saved'>('inbox');

  constructor() {
    const params = this.route.snapshot.paramMap;
    const articleId = params.get('articleId') || '';
    const src = params.get('source') || 'inbox';
    this.source.set(src as 'inbox' | 'saved');

    this.loadArticle(articleId, src);
  }

  private loadArticle(articleId: string, source: string): void {
    const obs = source === 'saved'
      ? this.savedService.getSaved()
      : this.inboxService.getInbox();

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (articles) => {
        const found = articles.find(a => a.id === articleId);
        if (found) {
          this.article.set(found);
        } else {
          this.error.set('Article not found');
        }
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load article');
        this.loading.set(false);
      },
    });
  }

  toggleContent(): void {
    if (!this.showFullContent() && !this.fullContent()) {
      this.loadFullContent();
    }
    this.showFullContent.update(v => !v);
  }

  private loadFullContent(): void {
    const a = this.article();
    if (!a) return;

    this.fullContentLoading.set(true);

    this.inboxService.getArticleContent(a.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.fullContent.set(this.sanitizer.sanitize(SecurityContext.HTML, res.content) || '');
        this.fullContentWordCount.set(res.wordCount);
        this.fullContentLoading.set(false);
      },
      error: () => {
        this.error.set('Failed to load full content');
        this.fullContentLoading.set(false);
      },
    });
  }

  formatDate = formatDate;
}
