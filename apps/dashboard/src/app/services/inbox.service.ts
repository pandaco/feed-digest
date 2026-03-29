import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { apiHeaders } from '../shared/api-headers';

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
}

@Injectable({ providedIn: 'root' })
export class InboxService {
  private http = inject(HttpClient);
  private apiBase = '/api/inbox';

  getInbox(): Observable<Article[]> {
    return this.http.get<Article[]>(this.apiBase, { headers: apiHeaders() });
  }

  deleteArticle(articleId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiBase}/${articleId}`,
      { headers: apiHeaders() },
    );
  }

  generateSummary(period?: string): Observable<{ html: string }> {
    return this.http.post<{ html: string }>(
      `${this.apiBase}/summary`,
      period ? { period } : {},
      { headers: apiHeaders() },
    );
  }

  bulkDelete(articleIds: string[]): Observable<{ deleted: number }> {
    return this.http.post<{ deleted: number }>(
      `${this.apiBase}/bulk-delete`,
      { articleIds },
      { headers: apiHeaders() },
    );
  }

  saveArticles(articleIds: string[]): Observable<{ saved: number }> {
    return this.http.post<{ saved: number }>(
      `${this.apiBase}/save`,
      { articleIds },
      { headers: apiHeaders() },
    );
  }
}
