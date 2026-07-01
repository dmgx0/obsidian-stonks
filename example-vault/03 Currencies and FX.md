# Currencies and FX

## The pence fix
London tickers often quote in **pence (GBp)** on Yahoo. Stonks normalizes them to pounds, so a portfolio total isn't 100× off.

- Lloyds (quoted in pence, shown in £): `$: LLOY.L`

## FX conversion
Multiply by a live FX pair (`...=X`) to convert currencies, and **label the result** with a currency modifier so it reads right:

- USD→GBP rate: `$: USDGBP=X`
- Apple priced in pounds: `$: AAPL * USDGBP=X | gbp`

> Without the label the number is converted but keeps the source's currency symbol. `| gbp` is you telling Stonks "this result is GBP now" — a label, not a conversion (the FX pair does the converting). A vault-wide base currency that converts everything automatically is on the roadmap.

## The mixed-currency guard
Adding amounts in different currencies is almost always a mistake — so Stonks shows the number but **flags it** (hover to see why):

- `$: AAPL + LLOY.L`  ← mixes USD and GBP

Converted a leg properly? Assert the result currency and the flag lifts:

- `$: AAPL * USDGBP=X + LLOY.L | gbp`  ← both legs in pounds now
