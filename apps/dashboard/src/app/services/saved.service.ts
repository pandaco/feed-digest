import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Article } from './inbox.service';

@Injectable({ providedIn: 'root' })
export class SavedService {
  private http = inject(HttpClient);
  private apiBase = '/api/saved';

  getSaved(): Observable<Article[]> {
    return this.http.get<Article[]>(this.apiBase);
  }

  deleteArticle(articleId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiBase}/${articleId}`);
  }

  bulkDelete(articleIds: string[]): Observable<{ deleted: number }> {
    return this.http.post<{ deleted: number }>(
      `${this.apiBase}/bulk-delete`,
      { articleIds },
    );
  }
}
