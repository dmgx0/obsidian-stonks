---
qty: 10
cost: 2500
---

# Your own math

Tickers act as **live variables** in a tiny expression (`+ - * / %`, parentheses). Put in your own quantities — they stay on your device.

- 10 shares of Apple: `$: AAPL * 10`
- A position vs its cost basis: `$: AAPL * 10 - 2500`
- A two-position portfolio total: `$: AAPL * 10 + MSFT * 5`
- Weighted blend: `$: (VWRA.L * 70 + CSPX.L * 30) / 100`

Same-currency expressions are formatted in that shared currency automatically — and every value **colours by its own day move**: a position moves with its ticker, a total with the weighted whole, and a cost-basis constant cancels out of the move.

## Display modifiers

Append `| …` to restyle one value (they combine — `| sign 0`):

- Colour by gain/loss instead of the day move: `$: AAPL * 10 - 2500 | sign`
- No colour: `$: AAPL * 10 | plain`
- Whole numbers: `$: AAPL * 10 + MSFT * 5 | 0`
- Always signed: `$: AAPL.change * 10 | +`
- Compact: `$: BTC-USD * 0.25 | compact`

(Inside a markdown table, write the pipe as `\|` — a markdown escaping rule, not a Stonks one.)

## Variables from properties

This note's frontmatter defines `qty: 10` and `cost: 2500`. Reference properties with `@` — numbers are literals, string properties are whole expressions (aliases):

- Position from a property: `$: AAPL * @qty`
- Live P&L vs your cost: `$: AAPL * @qty - @cost | sign +`

Change a property (the properties panel works) and every value using it repaints. Dataview queries the very same properties — one source of truth. A vault-wide **variables note** can be set in settings; the current note's properties win.

→ Put it all together in **[[06 Portfolio dashboard]]**: a full live portfolio with positions, P&L, and charts.

> Heavier math (units, full spreadsheets) is intentionally left to [Numerals](https://github.com/gtg922r/obsidian-numerals) — Stonks just makes the live numbers available.
