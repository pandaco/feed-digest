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