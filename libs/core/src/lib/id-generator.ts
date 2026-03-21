import { createHash } from 'node:crypto';

/**
 * Generates a SHA-256 hash for a given string (usually the URL).
 * Used as a unique identifier for articles.
 * 
 * @param url The string to hash.
 * @returns A 64-character hexadecimal SHA-256 string.
 */
export function generateId(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}
