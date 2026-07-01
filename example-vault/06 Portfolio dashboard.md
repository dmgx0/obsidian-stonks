---
qty_aapl: 25
qty_msft: 15
qty_nvda: 40
qty_googl: 20
qty_amzn: 18
qty_voo: 10
qty_btc: 0.25
cost_basis: 30990
portfolio: "AAPL * @qty_aapl + MSFT * @qty_msft + NVDA * @qty_nvda + GOOGL * @qty_googl + AMZN * @qty_amzn + VOO * @qty_voo + BTC-USD * @qty_btc"
portfolio_change: "AAPL.change * @qty_aapl + MSFT.change * @qty_msft + NVDA.change * @qty_nvda + GOOGL.change * @qty_googl + AMZN.change * @qty_amzn + VOO.change * @qty_voo + BTC-USD.change * @qty_btc"
---

# Portfolio dashboard 🚀

Your whole portfolio, **live**. Every price, value, and gain below is fetched on its own and updates in place — no buttons, no copy-paste.

This note shows two ways to do it:
1. **Just Stonks** — a hand-built table, zero other plugins. The core magic.
2. **Automated dashboard** — with [Dataview](https://github.com/blacksmithgu/obsidian-dataview), one holdings list drives a full table, totals, and charts drawn from Stonks' live numbers.

> The sample holdings are made up. Swap in your own tickers and quantities — your numbers never leave your device; only ticker symbols are sent.

---

## 1 · Just Stonks (no other plugin)

Each cell is a live `$:` expression, and every value colours by its **own day move**: each position with its ticker, the totals below with the whole (weighted) portfolio. The quantities live in this note's **properties** (the frontmatter above) as `@variables` — open the properties panel, change a `qty_…`, and the whole board repaints. Hover any value for details.

| Holding                | Shares               | Price        | Market value             | Today                           | Day %            |
| ---------------------- | -------------------- | ------------ | ------------------------ | ------------------------------- | ---------------- |
| Apple · AAPL           | `$: @qty_aapl \| 0`  | `$: AAPL`    | `$: AAPL * @qty_aapl`    | `$: AAPL.change * @qty_aapl`    | `$: AAPL.pct`    |
| Microsoft · MSFT       | `$: @qty_msft \| 0`  | `$: MSFT`    | `$: MSFT * @qty_msft`    | `$: MSFT.change * @qty_msft`    | `$: MSFT.pct`    |
| NVIDIA · NVDA          | `$: @qty_nvda \| 0`  | `$: NVDA`    | `$: NVDA * @qty_nvda`    | `$: NVDA.change * @qty_nvda`    | `$: NVDA.pct`    |
| Alphabet · GOOGL       | `$: @qty_googl \| 0` | `$: GOOGL`   | `$: GOOGL * @qty_googl`  | `$: GOOGL.change * @qty_googl`  | `$: GOOGL.pct`   |
| Amazon · AMZN          | `$: @qty_amzn \| 0`  | `$: AMZN`    | `$: AMZN * @qty_amzn`    | `$: AMZN.change * @qty_amzn`    | `$: AMZN.pct`    |
| Vanguard S&P 500 · VOO | `$: @qty_voo \| 0`   | `$: VOO`     | `$: VOO * @qty_voo`      | `$: VOO.change * @qty_voo`      | `$: VOO.pct`     |
| Bitcoin · BTC-USD      | `$: @qty_btc`        | `$: BTC-USD` | `$: BTC-USD * @qty_btc`  | `$: BTC-USD.change * @qty_btc`  | `$: BTC-USD.pct` |

The string properties `portfolio` and `portfolio_change` are **aliases** — whole expressions defined once and reused:

**Portfolio value:** `$: @portfolio`

**Today's P&L:** `$: @portfolio_change`

**Invested (cost basis):** `$: @cost_basis | usd 0`

**Unrealized P&L:** `$: @portfolio - @cost_basis | sign +`

One property edit updates every row, total, and the P&L. The `| sign +` **display modifiers** colour the P&L by gain/loss (instead of the default day move) and keep the sign visible; `| usd 0` labels a bare number as dollars. More knobs — `plain`, decimals, `compact` — in [[02 Your own math]]. (Inside table cells the pipe is escaped as `\|` — a markdown rule; Stonks reads both.)

> **Tip — `$` means maths in Obsidian.** A loose dollar sign in prose can pair with the `$` in a nearby `$:` value and turn the line into a broken formula. Write plain amounts without the sign (`30,990.00 USD`) or escape it (`\$30,990`) when they share a line with a `$:` expression.

---

## 2 · Automated dashboard (with Dataview)

The table above is great as a watchlist, but you maintain each row by hand. For a real portfolio, keep your holdings in **one** list and let a DataviewJS block compute everything — market value, weight, day move, and total return — straight from the Stonks API. It even draws the charts: Stonks stays a data provider; DataviewJS does the rendering.

> Needs the **Dataview** plugin (JS queries enabled). Without it, the block below just shows as code. Edit the `holdings` array at the top to make it yours.

```dataviewjs
// ── Your holdings. Quantities come from this note's properties — the
// same qty_… values section 1's @variables use, so ONE property edit
// updates the whole note. Names/costs are edited right here. ─────────
const p = dv.current();
const holdings = [
  { name: "Apple",            ticker: "AAPL",    qty: p.qty_aapl,  cost: 150 },
  { name: "Microsoft",        ticker: "MSFT",    qty: p.qty_msft,  cost: 300 },
  { name: "NVIDIA",           ticker: "NVDA",    qty: p.qty_nvda,  cost: 90 },
  { name: "Alphabet",         ticker: "GOOGL",   qty: p.qty_googl, cost: 140 },
  { name: "Amazon",           ticker: "AMZN",    qty: p.qty_amzn,  cost: 130 },
  { name: "Vanguard S&P 500", ticker: "VOO",     qty: p.qty_voo,   cost: 400 },
  { name: "Bitcoin",          ticker: "BTC-USD", qty: p.qty_btc,   cost: 40000 },
];
holdings.forEach(h => { h.qty = Number(h.qty) || 0; }); // missing property → 0
// ─────────────────────────────────────────────────────────────────────

const api = app.plugins.plugins["stonks"]?.api;
if (!api) {
  dv.paragraph("> [!warning] Enable the **Stonks** plugin to run this dashboard.");
} else {
  let busy = false, pending = false;
  const draw = async () => {
    if (busy) { pending = true; return; } // coalesce bursts, don't drop them
    busy = true;
    try {
      dv.container.empty();
      const quotes = await api.getQuotes(holdings.map(h => h.ticker));

      // Sparklines from api.getHistory: Stonks hands over the raw close
      // series; this block draws the SVG. Cached (~1 h), so redraws are free.
      const hist = new Map();
      if (api.getHistory) {
        await Promise.all(holdings.map(async h => {
          const s = await api.getHistory(h.ticker, "1mo").catch(() => null);
          if (s && s.points.length > 1) hist.set(h.ticker.toUpperCase(), s.points.map(p => p.close));
        }));
      }
      const spark = closes => {
        if (!closes) return "";
        const w = 84, ht = 22;
        const min = Math.min(...closes), max = Math.max(...closes), span = (max - min) || 1;
        const pts = closes.map((c, i) =>
          `${(i / (closes.length - 1) * w).toFixed(1)},${(ht - 1 - ((c - min) / span) * (ht - 2)).toFixed(1)}`).join(" ");
        const up = closes[closes.length - 1] >= closes[0];
        return `<svg width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}"><polyline points="${pts}" fill="none" stroke="var(${up ? "--color-green" : "--color-red"})" stroke-width="1.5"/></svg>`;
      };

      const rows = holdings.map(h => {
        const q = quotes.get(h.ticker.toUpperCase());
        if (!q) return { ...h, missing: true };
        const value = q.price * h.qty;
        const invested = h.cost * h.qty;
        const pl = value - invested;
        return {
          ...h, missing: false, price: q.price, value, invested, pl,
          plPct: invested ? (pl / invested) * 100 : 0,
          day: q.change * h.qty, dayPct: q.changePct,
        };
      });

      const live = rows.filter(r => !r.missing);
      const totalValue = live.reduce((s, r) => s + r.value, 0);
      const totalInvested = live.reduce((s, r) => s + r.invested, 0);
      const totalPl = totalValue - totalInvested;
      const totalPlPct = totalInvested ? (totalPl / totalInvested) * 100 : 0;
      const totalDay = live.reduce((s, r) => s + r.day, 0);

      // Formatting + colour helpers (theme-aware) ----------------
      const money = n => "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const sMoney = n => (n >= 0 ? "+" : "-") + money(Math.abs(n));
      const sPct = n => (n >= 0 ? "+" : "-") + Math.abs(n).toFixed(2) + "%";
      const col = n => (n >= 0 ? "var(--color-green)" : "var(--color-red)");
      const palette = ["--color-blue", "--color-purple", "--color-green", "--color-orange", "--color-cyan", "--color-pink", "--color-yellow"];
      const tint = i => `var(${palette[i % palette.length]})`;

      // Summary cards ---------------------------------------------
      const card = (label, value, color) => `
        <div style="flex:1;min-width:130px;padding:10px 14px;border:1px solid var(--background-modifier-border);border-radius:8px">
          <div style="font-size:var(--font-ui-smaller);color:var(--text-muted)">${label}</div>
          <div style="font-size:1.3em;font-weight:600;color:${color || "var(--text-normal)"}">${value}</div>
        </div>`;
      const cards = dv.el("div", "");
      cards.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;margin:4px 0 18px";
      cards.innerHTML =
        card("Market value", money(totalValue)) +
        card("Total return", `${sMoney(totalPl)} (${sPct(totalPlPct)})`, col(totalPl)) +
        card("Today", sMoney(totalDay), col(totalDay)) +
        card("Invested", money(totalInvested));

      // Allocation doughnut + legend ------------------------------
      dv.header(3, "Allocation");
      const doughnut = slices => {
        const total = slices.reduce((s, x) => s + x.value, 0) || 1;
        const R = 58, r = 36, cx = 64, cy = 64;
        // A single slice is a full circle — an SVG arc with coincident
        // endpoints renders nothing, so draw a ring instead.
        if (slices.length === 1) {
          return `<svg viewBox="0 0 128 128" width="128" height="128" style="flex:none"><circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${slices[0].color}" stroke-width="${R - r}"/></svg>`;
        }
        const at = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
        let a0 = -Math.PI / 2, paths = "";
        for (const s of slices) {
          const frac = s.value / total;
          const a1 = a0 + frac * 2 * Math.PI;
          const large = frac > 0.5 ? 1 : 0;
          const [x0, y0] = at(a0, R), [x1, y1] = at(a1, R), [x2, y2] = at(a1, r), [x3, y3] = at(a0, r);
          paths += `<path d="M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} A${r},${r} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z" fill="${s.color}"></path>`;
          a0 = a1;
        }
        return `<svg viewBox="0 0 128 128" width="128" height="128" style="flex:none">${paths}</svg>`;
      };
      const legend = live.map((r, i) =>
        `<div style="display:flex;align-items:center;gap:6px;margin:3px 0;font-size:var(--font-ui-smaller)">
           <span style="width:10px;height:10px;border-radius:2px;background:${tint(i)};flex:none"></span>
           <span style="flex:1">${r.name}</span>
           <span style="color:var(--text-muted)">${((r.value / totalValue) * 100).toFixed(1)}%</span>
         </div>`).join("");
      const alloc = dv.el("div", "");
      alloc.style.cssText = "display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:2px 0 16px";
      alloc.innerHTML = `<div>${doughnut(live.map((r, i) => ({ value: r.value, color: tint(i) })))}</div><div style="flex:1;min-width:200px">${legend}</div>`;

      // Profit / loss bars (diverging from a centre line) ---------
      dv.header(3, "Profit / loss by position");
      const maxAbs = Math.max(...live.map(r => Math.abs(r.pl)), 1);
      const bars = live.map(r => {
        const w = (Math.abs(r.pl) / maxAbs) * 100;
        const pos = r.pl >= 0;
        return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:var(--font-ui-smaller)">
          <div style="width:120px">${r.name}</div>
          <div style="flex:1;display:flex;height:13px">
            <div style="width:50%;display:flex;justify-content:flex-end">${pos ? "" : `<div style="width:${w}%;height:100%;background:var(--color-red);border-radius:3px 0 0 3px"></div>`}</div>
            <div style="width:1px;background:var(--text-faint)"></div>
            <div style="width:50%">${pos ? `<div style="width:${w}%;height:100%;background:var(--color-green);border-radius:0 3px 3px 0"></div>` : ""}</div>
          </div>
          <div style="width:110px;text-align:right;color:${col(r.pl)}">${sMoney(r.pl)}</div>
        </div>`;
      }).join("");
      dv.el("div", "").innerHTML = bars;

      // Detailed table --------------------------------------------
      dv.header(3, "Positions");
      dv.table(
        ["Holding", "Shares", "Price", "Value", "Weight", "Today %", "P&L", "P&L %", "1mo"],
        live.map(r => [
          `${r.name} · ${r.ticker}`,
          r.qty,
          money(r.price),
          money(r.value),
          `${((r.value / totalValue) * 100).toFixed(1)}%`,
          `<span style="color:${col(r.dayPct)}">${sPct(r.dayPct)}</span>`,
          `<span style="color:${col(r.pl)}">${sMoney(r.pl)}</span>`,
          `<span style="color:${col(r.plPct)}">${sPct(r.plPct)}</span>`,
          spark(hist.get(r.ticker.toUpperCase())),
        ])
      );

      const missing = rows.filter(r => r.missing).map(r => r.ticker);
      if (missing.length) {
        dv.paragraph(`_Couldn't fetch ${missing.join(", ")} right now — Stonks will retry._`);
      }
      const when = api.lastUpdated();
      dv.paragraph(`_Live — redraws as quotes refresh${when ? "; last fetch " + new Date(when).toLocaleTimeString() : ""}._`);
    } catch (e) {
      // Surface redraw failures — an emptied container must never stay blank.
      dv.paragraph(`> [!warning] Dashboard failed to draw: ${e?.message ?? e}`);
    } finally {
      busy = false;
      if (pending) { pending = false; void draw(); } // run the coalesced burst
    }
  };

  await draw();
  // Live updates: redraw whenever fresh quotes land (background refresh,
  // another note's fetch, a manual refresh). Self-cleaning: unsubscribes
  // once this block's container leaves the DOM.
  const stop = api.onQuotes?.(() => {
    if (!dv.container.isConnected) { stop?.(); return; }
    void draw();
  });
}
```

### How this works
- Your `holdings` array is the single source of truth — edit it once.
- `app.plugins.plugins["stonks"].api.getQuotes(...)` returns live, cached, **mobile-safe** quotes (the thing a raw `fetch` can't do on mobile).
- `api.onQuotes(cb)` subscribes to quote updates, so the dashboard **redraws itself** whenever fresh prices land — no reopening the note. It returns an unsubscribe function, and the block stops listening once its container leaves the DOM.
- `api.getHistory(ticker, range)` returns the raw close series (`1d`…`max`) — the **1mo sparklines** above are ~10 lines of SVG in this block. Stonks hands over data; it never draws a chart itself.
- Everything else — market value, weight, P&L, the doughnut, the bars — is plain JavaScript over those numbers. **Stonks provides the data; you (or DataviewJS) decide how to show it.**

That's the whole idea: a tiny, flexible data provider that drops its live numbers wherever you want them — inline, in a table, or in a chart.
