# Changelog

All notable changes to Stonks are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-07-02

Addresses automated review feedback from the community directory.

### Changed

- Release assets (`main.js`, `manifest.json`, `styles.css`) now ship with
  GitHub artifact attestations, so their provenance can be verified against
  this repository.
- Removed the one `!important` in `styles.css`; the invalid-input highlight in
  settings now wins by selector specificity instead.

## [1.0.0] - 2026-07-02

First public release.

### Added

- **Inline live quotes.** Inline code starting with `$:` materializes into the
  live price — in both Live Preview and Reading view, auto-refreshing, and
  mobile-safe via Obsidian's `requestUrl`.
- **Your own math.** A tiny expression engine (`+ - * / %`, parentheses) lets
  tickers act as live variables, so you can compute positions and portfolio
  totals inline. Your quantities stay on your device.
- **Dot-notation fields:** `.change`, `.pct`, `.prev` (exchange suffixes like
  `.L` are preserved — `VWRA.L.pct` is that ETF's percent change).
- **Day-move colouring.** Every value — computed expressions included — colours
  by its own day move (the expression re-evaluated at yesterday's closes): a
  position moves with its ticker, a portfolio total with the weighted whole,
  and cost-basis constants cancel out. FX rates stay neutral.
- **Display modifiers.** Append `| …` to any expression for per-value styling:
  `sign` / `plain` (colour by the value's sign / no colour), `+` (always
  signed), `0`–`8` (decimals), `compact` (1.2M), or an ISO currency code to
  label a converted result (which also lifts the mixed-currency flag).
- **Variables from note properties.** `@name` in an expression reads the note's
  frontmatter: numbers are literals, string properties are whole expressions
  (aliases) — `$: @portfolio - @cost_basis | sign`. Values repaint live when
  properties change; Dataview sees the same properties. An optional settings
  path designates a vault-wide variables note (note-local wins).
- **Autocomplete.** Typing inside a `$:` span suggests tickers you've used
  (with cached prices), fields after `.`, modifiers after `|`, and
  `@variables` from your properties (with value previews).
- **Currency handling.** Native per-quote currency, London pence (GBp/GBX) → GBP
  normalization, FX pairs (`EURUSD=X`), and a mixed-currency guard that flags
  ambiguous sums instead of implying a bogus total.
- **Soft failure with distinct states.** Unknown symbol vs. rate-limited vs.
  offline are shown differently; transient failures keep the last good value and
  retry (with backoff and a fallback Yahoo host). One bad ticker never breaks the
  rest of the note.
- **Persistence.** Last quotes are saved to the plugin data file for instant
  cold-start and brief offline resilience.
- **Public JS API** (`app.plugins.plugins.stonks.api`: `getQuote`, `getQuotes`,
  `refresh`, `lastUpdated`, `onQuotes`) for use from DataviewJS / Templater /
  JS Engine. `onQuotes(cb)` subscribes to quote updates (returns unsubscribe),
  so external dashboards re-render live as prices refresh. `getHistory(ticker,
  range)` returns cached historical close series (`1d`…`max`) for sparklines
  and charts drawn by your own blocks — Stonks stays chartless by design.
- **Settings:** trigger prefix (warns on clashes with Dataview/Numerals), cache
  lifetime, auto-refresh interval, and decimal places — all validated inline.
- **Accessibility.** Every rendered value carries an `aria-label`, announced by
  screen readers and shown as a themed tooltip.
- **Coexistence.** Claims only its own `$:` prefix and namespaces all styling
  under `stonks-*`, so it lives alongside Dataview, Numerals, and other
  inline-code plugins without collisions.

### Notes

- Quotes come from Yahoo Finance's unofficial endpoint; **only ticker symbols are
  sent**, and there is no telemetry.
