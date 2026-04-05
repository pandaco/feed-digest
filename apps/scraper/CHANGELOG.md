## 0.3.0 (2026-04-05)

### 🚀 Features

- **dashboard:** make date format configurable via DATE_FORMAT env var ([2f9eef2](https://github.com/pandaco/feed-digest/commit/2f9eef2))
- **ci:** simplify to 6 slots every 3h from 07h to 22h Paris ([3e58571](https://github.com/pandaco/feed-digest/commit/3e58571))
- **ci:** run every 2h from 07h to 21h Paris and fix notification timezone ([fc0ee8b](https://github.com/pandaco/feed-digest/commit/fc0ee8b))
- **scraper:** replace setup-notion with generic setup script for all backends ([2f55350](https://github.com/pandaco/feed-digest/commit/2f55350))
- **scraper:** add setup-notion script to provision Notion database schema ([84d9120](https://github.com/pandaco/feed-digest/commit/84d9120))

### 🩹 Fixes

- **scraper:** fix setup script for Notion type check and Google Sheets column order ([9ed4ce0](https://github.com/pandaco/feed-digest/commit/9ed4ce0))

## 0.2.0 (2026-04-02)

### 🚀 Features

- **scraper:** add fix-dates script to correct publication dates in bulk ([e7ed943](https://github.com/pandaco/feed-digest/commit/e7ed943))
- **pipeline:** compute importance from tag preferences and route all articles to inbox ([ae9b25e](https://github.com/pandaco/feed-digest/commit/ae9b25e))
- **dashboard:** add Angular dashboard app with tag preferences page ([3ce9ee5](https://github.com/pandaco/feed-digest/commit/3ce9ee5))
- **apps:** inject tagPreference in scraper and webhook ([30320b8](https://github.com/pandaco/feed-digest/commit/30320b8))
- **pipeline:** integrate tag preference learning in pipeline ([0746289](https://github.com/pandaco/feed-digest/commit/0746289))

### 🩹 Fixes

- resolve lint warnings for unused variables ([5c9d635](https://github.com/pandaco/feed-digest/commit/5c9d635))
- **ci:** update scraper workflow for run-once mode and production env ([cc8c740](https://github.com/pandaco/feed-digest/commit/cc8c740))
- improve recover logging, Notion parallel deletes, and local server ([05f51da](https://github.com/pandaco/feed-digest/commit/05f51da))

## 0.1.2 (2026-03-22)

This was a version bump only for scraper to align it with other projects, there were no code changes.