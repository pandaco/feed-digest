import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TagPreferenceService, TagPreferenceResponse } from '../../services/tag-preference.service';

interface TagRow {
  name: string;
  selectionCount: number;
  presentedCount: number;
  score: number;
  autoSelected: boolean;
  lastSelectedAt?: string;
}

@Component({
  selector: 'app-tag-preferences',
  imports: [FormsModule],
  templateUrl: './tag-preferences.html',
  styleUrl: './tag-preferences.scss',
})
export class TagPreferencesComponent {
  private service = inject(TagPreferenceService);

  apiToken = signal(localStorage.getItem('apiToken') || '');
  chatId = signal(localStorage.getItem('chatId') || '');
  loading = signal(false);
  error = signal<string | null>(null);
  data = signal<TagPreferenceResponse | null>(null);

  threshold = computed(() => this.data()?.threshold ?? 0.6);
  minRuns = computed(() => this.data()?.minRuns ?? 3);

  tags = computed<TagRow[]>(() => {
    const d = this.data();
    if (!d) return [];

    return Object.entries(d.tags)
      .map(([name, stats]) => {
        const scoreInfo = d.scores[name];
        return {
          name,
          selectionCount: stats.selectionCount,
          presentedCount: stats.presentedCount,
          score: scoreInfo?.score ?? 0,
          autoSelected: scoreInfo?.autoSelected ?? false,
          lastSelectedAt: stats.lastSelectedAt,
        };
      })
      .sort((a, b) => b.score - a.score);
  });

  autoSelectedCount = computed(() => this.tags().filter(t => t.autoSelected).length);

  loadPreferences(): void {
    const id = this.chatId().trim();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);

    this.service.getPreferences(id).subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.status === 401 ? 'Invalid API token' : 'Failed to load preferences');
        this.loading.set(false);
      },
    });
  }

  resetPreferences(): void {
    const id = this.chatId().trim();
    if (!id || !confirm('Reset all tag preferences? This cannot be undone.')) return;

    this.loading.set(true);
    this.service.resetPreferences(id).subscribe({
      next: () => {
        this.data.set(null);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to reset preferences');
        this.loading.set(false);
      },
    });
  }

  formatScore(score: number): string {
    return `${Math.round(score * 100)}%`;
  }

  formatDate(iso?: string): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  saveToken(token: string): void {
    this.apiToken.set(token);
    localStorage.setItem('apiToken', token);
  }

  saveChatId(id: string): void {
    this.chatId.set(id);
    localStorage.setItem('chatId', id);
  }
}
