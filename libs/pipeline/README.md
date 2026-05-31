# pipeline

Orchestration layer — wires the ports together. No UI, no I/O of its
own beyond calling the adapters it receives.

## Exports

- **`runPipeline(options)`** — one full run:
  scrape → fetch content → dedupe → noise-filter → enrich (LLM) →
  compute importance → persist → Telegram summary.
- **`buildNotificationData(options)`** — aggregates tag and source
  counts for the Telegram message. Used by the recovery script too.
- **`computeImportance(...)`** — internal pure function turning
  `{ tags, relevanceScore, tagPreferences }` into
  `'high' | 'medium' | 'low'`. The full priority table lives in
  [DEVELOPMENT.md §6](../../DEVELOPMENT.md#6-importance-computation).
