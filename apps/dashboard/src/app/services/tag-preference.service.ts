import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface TagStatsWithScore {
  selectionCount: number;
  presentedCount: number;
  lastSelectedAt?: string;
  score: number;
  autoSelected: boolean;
}

export interface TagPreferenceResponse {
  chatId: string;
  tags: Record<string, { selectionCount: number; presentedCount: number; lastSelectedAt?: string }>;
  scores: Record<string, { score: number; autoSelected: boolean }>;
  threshold: number;
  minRuns: number;
}

@Injectable({ providedIn: 'root' })
export class TagPreferenceService {
  private http = inject(HttpClient);
  private apiBase = '/api/preferences';

  private getHeaders(): HttpHeaders {
    const token = localStorage.getItem('apiToken') || '';
    return new HttpHeaders({
      'x-telegram-bot-api-secret-token': token,
    });
  }

  getPreferences(chatId: string): Observable<TagPreferenceResponse> {
    return this.http.get<TagPreferenceResponse>(
      `${this.apiBase}/${chatId}`,
      { headers: this.getHeaders() },
    );
  }

  resetPreferences(chatId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.apiBase}/${chatId}`,
      { headers: this.getHeaders() },
    );
  }
}
