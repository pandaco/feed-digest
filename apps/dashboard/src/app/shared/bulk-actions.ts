import { Observable, firstValueFrom } from 'rxjs';

export interface ChunkedResult {
  done: number;
  failed: number;
}

export const BULK_CHUNK_SIZE = 200;

/**
 * Runs an action over ids in sequential chunks so large batches stay under
 * API timeouts and report progress as they go. A failing chunk is counted
 * and skipped; remaining chunks still run.
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

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    try {
      await firstValueFrom(exec(chunk));
      done += chunk.length;
      opts.onChunkDone?.(chunk, done + failed);
    } catch {
      failed += chunk.length;
    }
  }

  return { done, failed };
}
