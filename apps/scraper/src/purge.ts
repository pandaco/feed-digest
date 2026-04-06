/**
 * Purge script for ALL collection in storage backends.
 * Deletes all items older than RETENTION_DAYS_ALL.
 *
 * Usage: npm run purge
 */
import * as dotenv from 'dotenv';
import { createStorage } from '@feed-digest/adapters';

dotenv.config();

async function main() {
  const retentionDays = parseInt(process.env['RETENTION_DAYS_ALL'] || '30', 10);
  const storage = createStorage('Purge');
  
  console.log(`[Purge] Starting manual purge (Retention: ${retentionDays} days)...`);
  try {
    const count = await storage.purgeExpiredArticles(retentionDays);
    console.log(`[Purge] Successfully removed ${count} articles.`);
  } catch (err) {
    console.error('[Purge] Failed:', err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Purge] Unexpected error:', err);
  process.exit(1);
});
