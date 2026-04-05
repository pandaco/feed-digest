## 0.3.0 (2026-04-05)

### 🚀 Features

- **dashboard:** make date format configurable via DATE_FORMAT env var ([2f9eef2](https://github.com/pandaco/feed-digest/commit/2f9eef2))
- **ci:** simplify to 6 slots every 3h from 07h to 22h Paris ([3e58571](https://github.com/pandaco/feed-digest/commit/3e58571))
- **ci:** run every 2h from 07h to 21h Paris and fix notification timezone ([fc0ee8b](https://github.com/pandaco/feed-digest/commit/fc0ee8b))
- **scraper:** replace setup-notion with generic setup script for all backends ([2f55350](https://github.com/pandaco/feed-digest/commit/2f55350))
- **scraper:** add setup-notion script to provision Notion database schema ([84d9120](https://github.com/pandaco/feed-digest/commit/84d9120))
- **core:** add table of contents extraction for long articles ([bde1007](https://github.com/pandaco/feed-digest/commit/bde1007))
- **dashboard:** add focus mode reader view with clean typography ([a61966c](https://github.com/pandaco/feed-digest/commit/a61966c))
- **dashboard:** add tag-based article clustering with synthesis ([8b36a56](https://github.com/pandaco/feed-digest/commit/8b36a56))
- **core:** add LLM relevance scoring with user interest profile ([c086879](https://github.com/pandaco/feed-digest/commit/c086879))
- **core:** add article snooze with presets and dedicated page ([a1ad0ea](https://github.com/pandaco/feed-digest/commit/a1ad0ea))

## 0.2.0 (2026-04-02)

### 🚀 Features

- **core:** normalize tags to lowercase across the entire pipeline ([5e47296](https://github.com/pandaco/feed-digest/commit/5e47296))
- **webhook:** add period-based summary and saved articles API ([01168fb](https://github.com/pandaco/feed-digest/commit/01168fb))
- **scraper:** add fix-dates script to correct publication dates in bulk ([e7ed943](https://github.com/pandaco/feed-digest/commit/e7ed943))
- **webhook:** add inbox save and saved articles API endpoints ([07c3f23](https://github.com/pandaco/feed-digest/commit/07c3f23))
- **webhook:** add inbox REST API endpoints ([e777720](https://github.com/pandaco/feed-digest/commit/e777720))
- **webhook:** add local Express API server for dashboard ([dacee9e](https://github.com/pandaco/feed-digest/commit/dacee9e))
- **dashboard:** add Angular dashboard app with tag preferences page ([3ce9ee5](https://github.com/pandaco/feed-digest/commit/3ce9ee5))
- **apps:** inject tagPreference in scraper and webhook ([30320b8](https://github.com/pandaco/feed-digest/commit/30320b8))

### 🩹 Fixes

- **ci:** update scraper workflow for run-once mode and production env ([cc8c740](https://github.com/pandaco/feed-digest/commit/cc8c740))
- improve recover logging, Notion parallel deletes, and local server ([05f51da](https://github.com/pandaco/feed-digest/commit/05f51da))

## 0.1.2 (2026-03-22)

This was a version bump only for webhook to align it with other projects, there were no code changes.