# Coexistence and the JS API

## Stonks only touches its own code
Stonks claims **only** inline code beginning with `$:`. Other inline-code plugins use their own prefixes, so they never collide — all three can sit in one note, each rendering its own line and ignoring the rest:

- Stonks → `$: AAPL`
- Numerals → `#: 2 + 2`
- Dataview → `=1 + 1`

With Dataview installed, its line evaluates to `2`; with Numerals, `#: 2 + 2` evaluates to `4`. Without those plugins the lines stay as plain text. Stonks renders its `$: AAPL` either way.

> Tip when documenting: don't write a bare prefix like an equals-in-backticks on its own — Dataview reads it as an empty query and shows a parse error. Always give a full example.

## Use the raw quotes from your own code
Any **DataviewJS / Templater / JS Engine** block can read Stonks' cached, mobile-safe quotes — the thing DataviewJS `fetch` can't do on mobile. With Dataview installed, the block below **runs live** and computes a portfolio from the Stonks API:

```dataviewjs
const stonks = app.plugins.plugins["stonks"]?.api;
if (!stonks) {
  dv.paragraph("Enable Stonks to run this.");
} else {
  const holdings = { "AAPL": 10, "MSFT": 5, "VWRA.L": 100 };
  let total = 0;
  for (const [ticker, qty] of Object.entries(holdings)) {
    const q = await stonks.getQuote(ticker);
    if (q) {
      dv.paragraph(`${ticker}: ${qty} × ${q.price} ${q.currency} = ${(q.price * qty).toFixed(2)}`);
      total += q.price * qty;
    }
  }
  dv.paragraph(`**Total: ${total.toFixed(2)} USD**`);
}
```

API: `getQuote(ticker)`, `getQuotes(tickers)`, `refresh()`, `lastUpdated()`. Without Dataview/JS Engine this block just shows as code.
