# pipeline

Orchestration layer — wires ports together, no UI or infrastructure concerns.

## Main exports

- **`runPipeline(options)`** — full pipeline: scrape → fetch content → enrich via LLM → compute importance → store → notify via Telegram
- **`buildNotificationData(options)`** — aggregates tag and source counts for Telegram messages

## Importance computation (`computeImportance`)

Internal function evaluated after each LLM enrichment. Priority order:

1. Any tag has `auto` override → **high**
2. All tags have `filtered` override → **low**
3. `relevanceScore ≥ 7` → **high**
4. Any tag's selection score ≥ threshold (after enough runs) → **high**
5. `relevanceScore ≤ 3` → **low**
6. Default → **medium**

`relevanceScore` is only present when `USER_INTERESTS` is configured. Without it, rules 3 and 5 never apply.

See [DEVELOPMENT.md](../../DEVELOPMENT.md) for full details.
