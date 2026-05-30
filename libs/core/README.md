# core

Pure domain layer — no external dependencies.

## Contents

**Models**
- `Article` — main entity: id, title, url, tags, summary, importance, relevanceScore, publishedAt, snoozedUntil, …
- `ArticleMetadata` — lightweight scraper output before enrichment
- `EnrichInput` / `EnrichOutput` — LLM enrichment contract
- `TagStats` / `TagPreference` — tag selection tracking

**Ports (interfaces)**
- `ScraperPort` — collect articles and fetch full content
- `LlmPort` — `enrich()`, `summarizeInbox()`, `summarizeRun()`
- `StoragePort` — inbox, saved, all collections; `getUntaggedArticles()`
- `TagPreferencePort` — record interactions, get overrides and scores
- `NotifierPort` — send Telegram summary

**Utilities**
- `normalizeTag` — lowercased, trimmed tag key
- `deduplicate` — dedup articles by SHA-256 URL hash
- `filterNoise` — remove noise articles (too short, no content)

See [DEVELOPMENT.md](../../DEVELOPMENT.md) for the full architecture and importance computation logic.
