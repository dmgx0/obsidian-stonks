# AGENTS.md

Guidance for coding agents working on **Stonks**, an Obsidian plugin that renders
live stock/ETF/crypto quotes inline (`` `$: AAPL * 25` ``) in both Live Preview
and Reading view. User docs live in `README.md`; this file covers how the code
is organized and the rules that keep it shippable.

## Commands

```sh
npm run lint      # eslint (incl. eslint-plugin-obsidianmd store rules)
npm test          # vitest, fully offline — no Obsidian, no network
npm run build     # tsc typecheck + esbuild bundle → main.js
npm run dev       # esbuild watch mode
npm run example   # build + symlink the plugin into ./example-vault
npm version x.y.z # bumps package.json and syncs manifest.json + versions.json
```

Keep all three of lint / test / build green before committing.

## Architecture

One esbuild bundle (`main.js`), **zero runtime dependencies**. The core is split
into pure, Obsidian-free modules with the Obsidian layer kept thin around them.

| Module | Role |
| --- | --- |
| `src/eval.ts` | Expression tokenizer/evaluator; tickers are variables, resolved via a `(symbol, field)` callback. Peels dot-fields (`.pct`) while preserving exchange suffixes (`VWRA.L`). |
| `src/modifiers.ts` | `\| …` display modifiers (`sign plain + 0–8 compact <ISO>`), split off *before* the expression parser. |
| `src/vars.ts` | `@name` frontmatter variables — textual expansion with parens-wrapping and a cycle guard, before parsing. |
| `src/currency.ts` | GBp/GBX pence → GBP normalization, FX-pair detection. |
| `src/format.ts` | Number/currency/percent/compact formatting. |
| `src/cache.ts` | Quote cache: per-error-reason TTLs, subscriber hook, persistence snapshot/seed. |
| `src/history.ts` | Historical close series cache for `api.getHistory` (not persisted). |
| `src/quotes.ts` | `YahooProvider` — unofficial Yahoo v8 chart endpoint with retry/backoff, query2 host fallback, and an 8 s timeout; returns typed `QuoteResult` (`ok` \| `notfound` \| `ratelimited` \| `network`). |
| `src/inline.ts` | Rendering for both views: value states, day-move colouring, aria-labels. |
| `src/suggest.ts` | Autocomplete: pure context classifier + suggestion sources under a thin `EditorSuggest` shell. |
| `src/settings.ts` | Settings tab with inline validation and a prefix-conflict guard. |
| `src/api.ts` | Public JS API (`app.plugins.plugins.stonks.api`): `getQuote(s)`, `refresh`, `onQuotes`, `getHistory`. |
| `src/main.ts` | Plugin entry: wiring, CM6 view plugin, reading post-processor, intervals, persistence. |

## Testing

- Pure modules (`eval`, `cache`, `currency`, `format`, `modifiers`, `vars`)
  have colocated `src/*.test.ts` files and run in plain node. `suggest.test.ts`
  is colocated too: its classifier and suggestion sources are pure functions,
  but the module itself imports `obsidian` for the `EditorSuggest` shell, which
  resolves against the mock.
- DOM/Obsidian-facing tests live in `test/`: vitest aliases `obsidian` →
  `test/mocks/obsidian.ts`, jsdom is enabled per-file, and `test/setup/dom.ts`
  shims Obsidian's `HTMLElement` helpers (`createEl`, `setText`, …).
- Everything runs offline from `npm test`. Two things are **not** autonomously
  testable and need manual verification in a real vault: CM6 Live Preview
  decorations (the matcher keys on Obsidian's `inline-code` token name) and
  mobile.

## Hard rules

- **Keep the core Obsidian-free.** `eval`/`cache`/`currency`/`format`/
  `modifiers`/`vars`/`history` must not import `obsidian` — that is what keeps
  them node-testable.
- **Zero runtime dependencies.** Everything ships in one small `main.js`.
- **Privacy: only ticker symbols ever leave the device.** Never send or persist
  holdings, quantities, or note content. No telemetry.
- **The Yahoo endpoint is unofficial.** Keep the `QuoteProvider` seam swappable
  and all failure modes typed and non-throwing; one bad ticker must never break
  the rest of a note.
- **Coexistence.** Claim only the configured `$:` inline prefix; never touch
  Dataview (`=`, `$=`) or Numerals (`#:`) spans. All CSS classes stay
  namespaced under `stonks-*`.
- **Never develop against a real vault.** `example-vault/` is the committed dev
  sandbox and demo (`npm run example` symlinks the build in; volatile
  `.obsidian` state is gitignored).

## Release

Push a version tag (`git tag 1.0.0 && git push origin 1.0.0`) →
`.github/workflows/release.yml` runs lint/test/build, attests the assets
(GitHub artifact attestations), and opens a **draft** GitHub release with
`main.js`, `manifest.json`, `styles.css` attached. Review, add notes from
`CHANGELOG.md`, publish. `manifest.json` version must equal the tag (no `v`
prefix); `npm version` keeps the three version files in sync. The community
directory picks up published releases automatically.
