import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Article {
  id: string;
  runAt: string;
  publishedAt: string;
  feedSource: string;
  title: string;
  url: string;
  tags: string[];
  summary: string;
  importance: 'high' | 'medium' | 'low';
  contentUnavailable: boolean;
  llmProvider: string;
  summaryLanguage: string;
  isSaved: boolean;
  scraperSource: string;
  relevanceScore?: number;
  snoozedUntil?: string;
}

export interface RetagProgress {
  type: 'start' | 'progress' | 'done' | 'error';
  retagged?: number;
  errors?: number;
  total?: number;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class InboxService {
  private http = inject(HttpClient);
  private apiBase = '/api/inbox';

  getInbox(): Observable<Article[]> {
    return this.http.get<Article[]>(this.apiBase);
  }

  deleteArticle(articleId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiBase}/${articleId}`);
  }

  generateSummary(period?: string): Observable<{ html: string }> {
    return this.http.post<{ html: string }>(
      `${this.apiBase}/summary`,
      period ? { period } : {},
    );
  }

  bulkDelete(articleIds: string[]): Observable<{ deleted: number }> {
    return this.http.post<{ deleted: number }>(
      `${this.apiBase}/bulk-delete`,
      { articleIds },
    );
  }

  saveArticles(articleIds: string[]): Observable<{ saved: number }> {
    return this.http.post<{ saved: number }>(
      `${this.apiBase}/save`,
      { articleIds },
    );
  }

  synthesize(articleIds: string[]): Observable<{ html: string }> {
    return this.http.post<{ html: string }>(
      `${this.apiBase}/synthesize`,
      { articleIds },
    );
  }

  snoozeArticle(articleId: string, snoozedUntil: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiBase}/${articleId}/snooze`,
      { snoozedUntil },
    );
  }

  unsnoozeArticle(articleId: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiBase}/${articleId}/unsnooze`,
      {},
    );
  }

  retagUntaggedStream(): Observable<RetagProgress> {
    return new Observable<RetagProgress>(observer => {
      const controller = new AbortController();
      const token = sessionStorage.getItem('apiToken') ?? '';

      fetch(`${this.apiBase}/retag-untagged`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-telegram-bot-api-secret-token': token } : {}),
        },
        signal: controller.signal,
      }).then(async response => {
        if (!response.ok || !response.body) {
          observer.error(new Error(`HTTP ${response.status}`));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() ?? '';

            for (const chunk of chunks) {
              const line = chunk.trim();
              if (line.startsWith('data: ')) {
                try {
                  const data: RetagProgress = JSON.parse(line.slice(6));
                  observer.next(data);
                  if (data.type === 'done' || data.type === 'error') {
                    observer.complete();
                    return;
                  }
                } catch { /* skip malformed */ }
              }
            }
          }
        } catch (err) {
          if ((err as Error).name !== 'AbortError') observer.error(err);
        }
        observer.complete();
      }).catch(err => {
        if (err?.name !== 'AbortError') observer.error(err);
      });

      return () => controller.abort();
    });
  }

  getSnoozed(): Observable<Article[]> {
    return this.http.get<Article[]>(`${this.apiBase}/snoozed`);
  }

  getArticleContent(articleId: string): Observable<{ content: string; wordCount: number }> {
    return this.http.get<{ content: string; wordCount: number }>(`/api/articles/${articleId}/content`);
  }

  getArticleToc(articleId: string): Observable<{ toc: { level: 2 | 3; text: string }[] }> {
    return this.http.get<{ toc: { level: 2 | 3; text: string }[] }>(`/api/articles/${articleId}/toc`);
  }

  getInterests(): Observable<{ text: string }> {
    return this.http.get<{ text: string }>('/api/interests');
  }

  saveInterests(text: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/interests', { text });
  }
}
