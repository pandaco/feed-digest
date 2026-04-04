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

  getSnoozed(): Observable<Article[]> {
    return this.http.get<Article[]>(`${this.apiBase}/snoozed`);
  }

  getArticleContent(articleId: string): Observable<{ content: string; wordCount: number }> {
    return this.http.get<{ content: string; wordCount: number }>(`/api/articles/${articleId}/content`);
  }

  getInterests(): Observable<{ text: string }> {
    return this.http.get<{ text: string }>('/api/interests');
  }

  saveInterests(text: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/interests', { text });
  }
}
