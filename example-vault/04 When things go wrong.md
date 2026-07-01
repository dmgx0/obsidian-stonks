# When things go wrong

Stonks fails **softly** — one bad ticker never breaks the rest of the note.

- Unknown symbol → a red dash (hover for the name): `$: NOTATICKER`
- A valid-looking but empty result is treated the same way: `$: ZZZZ`

If Yahoo rate-limits you or you're offline, values show a **muted** `—` with a "will retry" tooltip instead of a hard error — they refresh themselves once things recover. A short cache, retries with a fallback host, and per-reason back-off keep this rare.

Everything below the failing value still renders fine:

- Working: `$: AAPL` · Broken: `$: NOPE` · Working: `$: MSFT`
