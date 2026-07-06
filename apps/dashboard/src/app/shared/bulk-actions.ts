import { WritableSignal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { Article } from '../services/inbox.service';
import { ToastService } from '../services/toast.service';

export interface ChunkedResult {
  done: number;
  failed: number;
  failedIds: string[];
}

export const BULK_CHUNK_SIZE = 200;

// Above this many articles, a bulk operation is treated as a mass cleanup:
// it asks for confirmation and (on the inbox) skips tag-preference feedback.
// Deliberately independent from PAGE_SIZE — pagination tweaks must not
// silently change feedback policy or safety prompts.
export const MASS_ACTION_THRESHOLD = 50;

/** Returns a copy of `set` without the given ids. */
export function withoutIds(set: Set<string>, ids: Iterable<string>): Set<string> {
  const remove = new Set(ids);
  return new Set([...set].filter(id => !remove.has(id)));
}

/**
 * Runs an action over ids in sequential chunks so large batches stay under
 * API timeouts and report progress as they go. A failing chunk is counted
 * and skipped; remaining chunks still run. `processed` passed to
 * onChunkDone reflects only ids whose chunk actually succeeded.
 */
export async function runChunked(
  ids: string[],
  exec: (chunk: string[]) => Observable<unknown>,
  opts: {
    chunkSize?: number;
    onChunkDone?: (chunkIds: string[], processed: number) => void;
  } = {},
): Promise<ChunkedResult> {
  const chunkSize = opts.chunkSize ?? BULK_CHUNK_SIZE;
  let done = 0;
  let failed = 0;
  const failedIds: string[] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    try {
      await firstValueFrom(exec(chunk));
      done += chunk.length;
      opts.onChunkDone?.(chunk, done);
    } catch (err) {
      console.error(`[bulk] chunk of ${chunk.length} ids failed:`, err);
      failed += chunk.length;
      failedIds.push(...chunk);
    }
  }

  return { done, failed, failedIds };
}

export interface BulkOpVerbs {
  /** Progress form, e.g. "Deleting". */
  progress: string;
  /** Past form, e.g. "deleted". */
  past: string;
}

export interface BulkOpContext {
  articles: WritableSignal<Article[]>;
  selectedIds: WritableSignal<Set<string>>;
  busyIds: WritableSignal<Set<string>>;
  expandedId: WritableSignal<string | null>;
  toast: ToastService;
  /** Runs after the op settles (e.g. clear stale filters on an emptied view). */
  afterFinish?: () => void;
}

/**
 * Shared driver for chunked bulk operations: marks ids busy, streams
 * progress into a toast, prunes only the ids that actually succeeded from
 * the list and selection (failed ids stay selected so the user can retry),
 * and resolves the toast on every path.
 */
export async function runBulkOp(
  ctx: BulkOpContext,
  ids: string[],
  exec: (chunk: string[]) => Observable<unknown>,
  verbs: BulkOpVerbs,
): Promise<ChunkedResult> {
  ctx.busyIds.update(set => new Set([...set, ...ids]));
  const toast = ctx.toast.progress(
    `${verbs.progress} ${ids.length} article${ids.length > 1 ? 's' : ''}…`,
    ids.length,
  );

  const result = await runChunked(ids, exec, {
    onChunkDone: (chunk, processed) => {
      const chunkSet = new Set(chunk);
      ctx.articles.update(list => list.filter(a => !chunkSet.has(a.id)));
      ctx.selectedIds.update(set => withoutIds(set, chunk));
      toast.update(processed, ids.length);
    },
  });

  ctx.busyIds.update(set => withoutIds(set, ids));
  const expanded = ctx.expandedId();
  if (expanded && !ctx.articles().some(a => a.id === expanded)) {
    ctx.expandedId.set(null);
  }

  if (result.failed === 0) {
    toast.success(`${result.done} article${result.done > 1 ? 's' : ''} ${verbs.past}`);
  } else {
    toast.error(`${result.done} ${verbs.past}, ${result.failed} failed`);
  }
  ctx.afterFinish?.();
  return result;
}
