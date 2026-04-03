import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { InboxService } from '../../services/inbox.service';

@Component({
  selector: 'app-interests',
  imports: [FormsModule],
  templateUrl: './interests.html',
  styleUrl: './interests.scss',
})
export class InterestsComponent {
  private service = inject(InboxService);
  private destroyRef = inject(DestroyRef);

  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  text = signal('');
  wordCount = computed(() => this.text().split(/\s+/).filter(w => w.length > 0).length);

  loadInterests(): void {
    this.loading.set(true);
    this.error.set(null);

    this.service.getInterests().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.text.set(res.text);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load interests');
        this.loading.set(false);
      },
    });
  }

  save(): void {
    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);

    this.service.saveInterests(this.text()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.success.set('Interests saved successfully');
        setTimeout(() => this.success.set(null), 3000);
      },
      error: () => {
        this.saving.set(false);
        this.error.set('Failed to save interests');
      },
    });
  }
}
