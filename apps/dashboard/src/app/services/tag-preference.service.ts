import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { apiHeaders } from '../shared/api-headers';

export type TagOverride = 'auto' | 'filtered';

export interface TagPreferenceResponse {
  chatId: string;
  tags: Record<string, { selectionCount: number; presentedCount: number; lastSelectedAt?: string }>;
  scores: Record<string, { score: number; autoSelected: boolean }>;
  tagOverrides: Record<string, TagOverride>;
  runCount: number;
  threshold: number;
  minRuns: number;
}

@Injectable({ providedIn: 'root' })
export class TagPreferenceService {
  private http = inject(HttpClient);
  private apiBase = '/api/preferences';

  getPreferences(chatId: string): Observable<TagPreferenceResponse> {
    return this.http.get<TagPreferenceResponse>(
      `${this.apiBase}/${chatId}`,
      { headers: apiHeaders() },
    );
  }

  resetPreferences(chatId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiBase}/${chatId}`,
      { headers: apiHeaders() },
    );
  }

  setTagOverride(chatId: string, tag: string, override: TagOverride | null): Observable<{ tag: string; override: TagOverride | null }> {
    return this.http.post<{ tag: string; override: TagOverride | null }>(
      `${this.apiBase}/${chatId}/tags/${encodeURIComponent(tag)}/override`,
      { override },
      { headers: apiHeaders() },
    );
  }
}
