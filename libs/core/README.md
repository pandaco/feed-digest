# core

Pure domain layer. Zero external dependencies.

## Entities

- `Article` — main entity (id, title, url, tags, summary, importance,
  relevanceScore, publishedAt, snoozedUntil, …)
- `ArticleMetadata` — raw scraper output before enrichment
- `EnrichInput` / `EnrichOutput` — LLM contract
- `LlmUsage` — cumulative `{ calls, inputTokens, outputTokens }`
- `TagPreference` / `TagStats` — tag selection tracking

## Ports

- `ScraperPort` — `collect()`, `fetchContent()`, `markAsRead()`
- `LlmPort` — `enrich()`, `summarizeInbox()`, `summarizeRun()`, `getUsage()`
- `StoragePort` — inbox / saved / all collections, `getUntaggedArticles()`
- `TagPreferencePort` — record interactions, get scores and overrides
- `NotifierPort` — send the run summary

## Utilities

- `normalizeTag` / `normalizeTags` — lowercased, trimmed tag keys
- `deduplicate` — by SHA-256 URL hash + title similarity
- `filterNoise` — drop articles with empty/near-empty content
- `toc` — extract `h2` / `h3` outline from HTML

## Shared types

- `LlmProvider = 'claude' | 'gemini' | 'ollama'` — single source of
  truth, re-used in `Article.llmProvider`, `RunSummary.llmProvider`,
  `createLlm()`, and the pipeline options.
