# Inline prices

A bare ticker resolves to its **live price**, formatted in its own currency. The colour shows today's move (green up / red down).

- Apple: `$: AAPL`
- Microsoft: `$: MSFT`
- A London-listed world ETF: `$: VWRA.L`
- Bitcoin: `$: BTC-USD`
- The S&P 500 index: `$: ^GSPC`

Hover any value to see the ticker, exact price, day change and last-updated time.

Tickers are whatever Yahoo Finance understands: plain symbols, `.EXCHANGE` suffixes (`VWRA.L`), crypto pairs (`BTC-USD`), indices (`^GSPC`).

> [!tip] Autocomplete
> Start typing inside a `$:` span and Stonks suggests tickers you've already used (with their cached prices), `.fields` after a dot, `|` modifiers after a pipe, and `@variables` from your properties.

## Fields
A bare ticker is the price; add a dot-field for more:

- Apple's change today: `$: AAPL.change`
- …as a percent: `$: AAPL.pct`
- Previous close: `$: AAPL.prev`

The exchange suffix is kept, so this is `VWRA.L`'s % change: `$: VWRA.L.pct`
