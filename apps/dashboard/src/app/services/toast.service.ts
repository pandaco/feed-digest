import { Injectable, signal } from '@angular/core';

export type ToastKind = 'progress' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  current?: number;
  total?: number;
}

/** Handle over a persistent progress toast: tick it, then resolve it in place. */
export interface ProgressToastHandle {
  update(current: number, total: number): void;
  success(message: string): void;
  error(message: string): void;
}

const SUCCESS_DISMISS_MS = 4000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<Toast[]>([]);
  private nextId = 1;

  success(message: string): void {
    const id = this.push({ kind: 'success', message });
    setTimeout(() => this.dismiss(id), SUCCESS_DISMISS_MS);
  }

  error(message: string): void {
    this.push({ kind: 'error', message });
  }

  progress(message: string): ProgressToastHandle {
    const id = this.push({ kind: 'progress', message });
    return {
      update: (current, total) => this.patch(id, { current, total }),
      success: (msg) => {
        this.patch(id, { kind: 'success', message: msg, current: undefined, total: undefined });
        setTimeout(() => this.dismiss(id), SUCCESS_DISMISS_MS);
      },
      error: (msg) => {
        this.patch(id, { kind: 'error', message: msg, current: undefined, total: undefined });
      },
    };
  }

  dismiss(id: number): void {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }

  private push(toast: Omit<Toast, 'id'>): number {
    const id = this.nextId++;
    this.toasts.update(list => [...list, { ...toast, id }]);
    return id;
  }

  private patch(id: number, changes: Partial<Toast>): void {
    this.toasts.update(list => list.map(t => (t.id === id ? { ...t, ...changes } : t)));
  }
}
