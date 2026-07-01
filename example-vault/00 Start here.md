# Stonks — example vault 📈

This vault shows what **Stonks** can do. Open any note; the prices are **live** from Yahoo Finance and refresh on their own.

You write a ticker in inline code with a `$:` prefix and it materializes into the value, right in the text — in both editing (Live Preview) and reading views.

A taste — Apple, live right now: `$: AAPL`

**Want the "wow" first?** → **[[06 Portfolio dashboard]]** is a complete live portfolio: positions, today's P&L, an allocation chart, and total return — all updating on their own.

## Tour
- [[06 Portfolio dashboard]] — ⭐ the showcase: a full live portfolio with charts
- [[01 Inline prices]] — the basics
- [[02 Your own math]] — positions and portfolio totals
- [[03 Currencies and FX]] — pence fix, conversions, the mixed-currency guard
- [[04 When things go wrong]] — soft failure / error states
- [[05 Coexistence and the JS API]] — playing nice with other plugins

## Recommended plugins (optional)
For the full tour, install these from the community store. Then the coexistence lines and the live JS-API portfolio in [[05 Coexistence and the JS API]] render; without them, those specific lines just stay as plain text.

- **Dataview** — the automated dashboard in [[06 Portfolio dashboard]], the live JS-API portfolio in [[05 Coexistence and the JS API]], plus one coexistence line.
- **Numerals** — the other coexistence line.

Stonks itself needs no other plugin.

> Privacy: only ticker symbols are ever sent to Yahoo. Your quantities, costs and totals are computed locally and never leave your device.
