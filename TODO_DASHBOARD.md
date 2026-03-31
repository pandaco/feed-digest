# Dashboard — Improvements TODO

Audit done on 2026-03-31.

## Security
- [x] 1. XSS in summary — sanitized via DomSanitizer
- [x] 2. API token migrated to sessionStorage
- [x] 3. HTTP interceptor — centralized auth headers, removed apiHeaders()

## Performance
- [x] 4. Memory leaks — all `.subscribe()` use `takeUntilDestroyed(destroyRef)`
- [x] 5. `filteredArticles` split into structuralFiltered + searchAndSort
- [x] 6. `timeBuckets` uses memoized articleDates computed
- [x] 7. Shared types, constants and logic extracted to article-list.utils.ts

## Ergonomie / UX
- [x] 8. No skeleton loading — just text "Loading..."
- [x] 9. Errors don't auto-dismiss
- [x] 10. Search input fixed width (220px) — not responsive on mobile
- [x] 11. No visible filtered result counter
- [x] 12. No shortcut to reset all filters at once
- [x] 13. Summary HTML can be very long — no max-height/scroll
- [x] 14. No confirmation before bulk delete
- [x] 15. No pagination/virtualisation for large datasets

## Visual
- [ ] 16. No dark mode (navbar is dark but rest is light-only)
- [ ] 17. No animated loading skeleton (shimmer)
- [ ] 18. Importance badges could have icons
- [ ] 19. Timeline histogram has no hover tooltip
- [ ] 20. No transition/animation on filter panel show/hide

## Accessibility
- [ ] 21. Tag filter chips missing `aria-pressed` and `role`
- [ ] 22. Importance tabs missing `role="tablist"`/`role="tab"`
- [ ] 23. Timeline bars have no ARIA attributes
- [ ] 24. No focus trap in help modals
- [ ] 25. `formatDate()` manual — use `Intl.DateTimeFormat` for locale
