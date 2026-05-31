## 0.3.0 (2026-04-05)

### 🚀 Features

- **ci:** run every 2h from 07h to 21h Paris and fix notification timezone ([fc0ee8b](https://github.com/pandaco/feed-digest/commit/fc0ee8b))
- **ci:** simplify to 6 slots every 3h from 07h to 22h Paris ([3e58571](https://github.com/pandaco/feed-digest/commit/3e58571))
- **core:** add article snooze with presets and dedicated page ([a1ad0ea](https://github.com/pandaco/feed-digest/commit/a1ad0ea))
- **core:** add LLM relevance scoring with user interest profile ([c086879](https://github.com/pandaco/feed-digest/commit/c086879))
- **core:** add table of contents extraction for long articles ([bde1007](https://github.com/pandaco/feed-digest/commit/bde1007))
- **core:** add LLM usage tracking and simplify Telegram notification ([588841b](https://github.com/pandaco/feed-digest/commit/588841b))
- **dashboard:** enhance search with tag matching and relevance scoring ([133acad](https://github.com/pandaco/feed-digest/commit/133acad))
- **dashboard:** add tag-based article clustering with synthesis ([8b36a56](https://github.com/pandaco/feed-digest/commit/8b36a56))
- **dashboard:** add focus mode reader view with clean typography ([a61966c](https://github.com/pandaco/feed-digest/commit/a61966c))
- **dashboard:** enhance cluster view with dates, bulk actions and recursive splitting ([3a0baa0](https://github.com/pandaco/feed-digest/commit/3a0baa0))
- **dashboard:** make date format configurable via localStorage ([6194fa8](https://github.com/pandaco/feed-digest/commit/6194fa8))
- **dashboard:** make date format configurable via DATE_FORMAT env var ([2f9eef2](https://github.com/pandaco/feed-digest/commit/2f9eef2))
- **scraper:** add setup-notion script to provision Notion database schema ([84d9120](https://github.com/pandaco/feed-digest/commit/84d9120))
- **scraper:** replace setup-notion with generic setup script for all backends ([2f55350](https://github.com/pandaco/feed-digest/commit/2f55350))

### 🩹 Fixes

- **adapters:** gracefully skip missing optional Notion properties ([bb8fa6f](https://github.com/pandaco/feed-digest/commit/bb8fa6f))
- **adapters:** send Relevance Score as Notion number type, not rich_text ([d50a2e8](https://github.com/pandaco/feed-digest/commit/d50a2e8))
- **core:** skip noise filter when excerpt is empty ([d8f7da7](https://github.com/pandaco/feed-digest/commit/d8f7da7))
- **dashboard:** use consistent YYYY-MM-DD HH:mm format for all dates ([34578ac](https://github.com/pandaco/feed-digest/commit/34578ac))
- **dashboard:** force YYYY-MM-DD HH:mm date format regardless of browser locale ([f20a0bb](https://github.com/pandaco/feed-digest/commit/f20a0bb))
- **scraper:** fix setup script for Notion type check and Google Sheets column order ([9ed4ce0](https://github.com/pandaco/feed-digest/commit/9ed4ce0))

## 0.2.0 (2026-04-02)

### 🚀 Features

- **adapters:** add TagPreference adapters and factory ([be082fc](https://github.com/pandaco/feed-digest/commit/be082fc))
- **adapters:** support pre-selected tags in Telegram keyboard ([bead5c3](https://github.com/pandaco/feed-digest/commit/bead5c3))
- **adapters:** implement tag override in DynamoDB and file adapters ([0046aec](https://github.com/pandaco/feed-digest/commit/0046aec))
- **adapters:** add composite scraper, date extraction, scraper source, and message truncation ([f0a042a](https://github.com/pandaco/feed-digest/commit/f0a042a))
- **apps:** inject tagPreference in scraper and webhook ([30320b8](https://github.com/pandaco/feed-digest/commit/30320b8))
- **core:** add TagPreference domain model and port ([9653d2d](https://github.com/pandaco/feed-digest/commit/9653d2d))
- **core:** add tag overrides and run count to tag preference model ([4361a9d](https://github.com/pandaco/feed-digest/commit/4361a9d))
- **core:** add summarizeInbox to LLM port and adapters ([c52116f](https://github.com/pandaco/feed-digest/commit/c52116f))
- **core:** add getFromSaved and deleteFromSaved to storage port and adapters ([7eade90](https://github.com/pandaco/feed-digest/commit/7eade90))
- **core:** add FetchContentResult, scraper source field, and remove importance from LLM ([4417777](https://github.com/pandaco/feed-digest/commit/4417777))
- **core:** normalize tags to lowercase across the entire pipeline ([5e47296](https://github.com/pandaco/feed-digest/commit/5e47296))
- **core:** deduplicate articles by URL and title similarity ([0865ae7](https://github.com/pandaco/feed-digest/commit/0865ae7))
- **core:** auto-archive noise articles before LLM enrichment ([72fd6ed](https://github.com/pandaco/feed-digest/commit/72fd6ed))
- **dashboard:** add Angular dashboard app with tag preferences page ([3ce9ee5](https://github.com/pandaco/feed-digest/commit/3ce9ee5))
- **dashboard:** add tag state management with filters and search ([9785705](https://github.com/pandaco/feed-digest/commit/9785705))
- **dashboard:** add inbox page with filtering, bulk actions, and AI summary ([4189738](https://github.com/pandaco/feed-digest/commit/4189738))
- **dashboard:** add global auth, saved page, and inbox save actions ([1171982](https://github.com/pandaco/feed-digest/commit/1171982))
- **dashboard:** add triage view, increase CSS budget, and update shared styles ([ade09bc](https://github.com/pandaco/feed-digest/commit/ade09bc))
- **dashboard:** add keyboard shortcuts, temporal histogram, advanced filters, and improve table layout ([2458fe8](https://github.com/pandaco/feed-digest/commit/2458fe8))
- **dashboard:** replace source dropdown with multi-select chip filters ([1720190](https://github.com/pandaco/feed-digest/commit/1720190))
- **dashboard:** move shared styles to global stylesheet ([b777f7f](https://github.com/pandaco/feed-digest/commit/b777f7f))
- **dashboard:** add pagination and responsive search input ([378acaf](https://github.com/pandaco/feed-digest/commit/378acaf))
- **dashboard:** add dark mode via CSS custom properties ([e6dd479](https://github.com/pandaco/feed-digest/commit/e6dd479))
- **dashboard:** add importance badge icons and timeline tooltips ([fa5b2c8](https://github.com/pandaco/feed-digest/commit/fa5b2c8))
- **dashboard:** add undo, speed mode and avg time to triage view ([abf40d8](https://github.com/pandaco/feed-digest/commit/abf40d8))
- **pipeline:** integrate tag preference learning in pipeline ([0746289](https://github.com/pandaco/feed-digest/commit/0746289))
- **pipeline:** support tag overrides for filtering and auto-selection ([b7c742c](https://github.com/pandaco/feed-digest/commit/b7c742c))
- **pipeline:** compute importance from tag preferences and route all articles to inbox ([ae9b25e](https://github.com/pandaco/feed-digest/commit/ae9b25e))
- **scraper:** add fix-dates script to correct publication dates in bulk ([e7ed943](https://github.com/pandaco/feed-digest/commit/e7ed943))
- **telegram:** display article count per tag in keyboard buttons ([d5eef76](https://github.com/pandaco/feed-digest/commit/d5eef76))
- **webhook:** add local Express API server for dashboard ([dacee9e](https://github.com/pandaco/feed-digest/commit/dacee9e))
- **webhook:** add inbox REST API endpoints ([e777720](https://github.com/pandaco/feed-digest/commit/e777720))
- **webhook:** add inbox save and saved articles API endpoints ([07c3f23](https://github.com/pandaco/feed-digest/commit/07c3f23))
- **webhook:** add period-based summary and saved articles API ([01168fb](https://github.com/pandaco/feed-digest/commit/01168fb))

### 🩹 Fixes

- handle archived Notion pages and dashboard signal init ([6cbf9b9](https://github.com/pandaco/feed-digest/commit/6cbf9b9))
- improve recover logging, Notion parallel deletes, and local server ([05f51da](https://github.com/pandaco/feed-digest/commit/05f51da))
- resolve lint warnings for unused variables ([5c9d635](https://github.com/pandaco/feed-digest/commit/5c9d635))
- **adapters:** remove unnecessary regex escape in clean-html ([75d5a9e](https://github.com/pandaco/feed-digest/commit/75d5a9e))
- **ci:** update scraper workflow for run-once mode and production env ([cc8c740](https://github.com/pandaco/feed-digest/commit/cc8c740))
- **dashboard:** use span instead of label for source filter heading ([9235568](https://github.com/pandaco/feed-digest/commit/9235568))
- **dashboard:** harden security — sanitize HTML, sessionStorage, HTTP interceptor ([b5d9f3e](https://github.com/pandaco/feed-digest/commit/b5d9f3e))
- **dashboard:** prevent memory leaks with takeUntilDestroyed on all subscriptions ([590389c](https://github.com/pandaco/feed-digest/commit/590389c))
- **dashboard:** auto-dismiss errors on triage and tag-preferences pages ([2cc0085](https://github.com/pandaco/feed-digest/commit/2cc0085))
- **dashboard:** add ARIA attributes to triage help modal ([64c971d](https://github.com/pandaco/feed-digest/commit/64c971d))
- **dashboard:** add focus trap in help modals ([ff1a2fa](https://github.com/pandaco/feed-digest/commit/ff1a2fa))
- **dashboard:** improve a11y on help modals, filters and unused vars ([301fde2](https://github.com/pandaco/feed-digest/commit/301fde2))

### 🔥 Performance

- **dashboard:** split computed chain, memoize dates, deduplicate logic ([5a3ed58](https://github.com/pandaco/feed-digest/commit/5a3ed58))

## 0.1.2 (2026-03-22)

This was a version bump only, there were no code changes.

## 0.1.1 (2026-03-22)

This was a version bump only, there were no code changes.

## 0.1.0 (2026-03-21)

### 🚀 Features

- add saved/starred article detection and routing
- **adapters:** implement Inoreader scraper with Playwright
- **core:** define scraper domain models and ports
- **core:** define notifier and session domain models and ports
- **deploy:** implement AWS Lambda infrastructure and CI/CD pipelines
- **dev:** implement local development server for interactive webhook testing
- **dev:** switch local server to Polling mode for better privacy
- **llm:** implement AI enrichment adapters for Claude and Gemini
- **llm:** allow configurable AI models via environment variables
- **llm:** add run synthesis and configurable max tags
- **notifier:** implement interactive Telegram notification adapter
- **notifier:** add 2-column keyboard, synthesis display, duration and tag ordering
- **pipeline:** implement core orchestration logic
- **pipeline:** implement Telegram callback handler and DynamoDB storage
- **pipeline:** add configurable random delays between LLM calls
- **pipeline:** switch to sequential processing with immediate save and mark-as-read
- **recover:** implement comprehensive article recovery and re-enrichment
- **repo:** initialize pipeline library and lambda-webhook application
- **scraper:** implement main execution logic for article collection
- **scraper:** implement mark-as-read via DOM navigation with persistent page
- **session:** add local file-based session adapter for offline development
- **storage:** implement Google Sheets storage adapter
- **storage:** add URL column and extract real source name
- **storage:** add getFromInbox and auto-repair empty tab headers
- **storage:** integrate Notion as an alternative database backend
- **telegram:** restructure notifications into 4 separate messages

### 🩹 Fixes

- use tsx for dev:scraper instead of nx serve
- **llm:** change default Gemini model to gemini-1.5-pro for better availability
- **repo:** correct NX scraper command to 'serve scraper'
- **scraper:** add missing FileSessionAdapter import in main entry point
- **storage:** use correct formula separator based on locale (semicolon for FR)
- **webhook:** handle already archived pages in Notion and fix logging

### 🔥 Performance

- **pipeline:** optimize API usage with random delays and disabled digest
- **pipeline:** implement configurable parallel article enrichment