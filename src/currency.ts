// Pure currency helpers — no Obsidian imports, so they're unit-testable.

// Yahoo reports some venues in a minor unit rather than the major currency —
// most importantly London (GBp = pence). If we don't normalize, a price of
// £50.00 comes back as 5000 and a portfolio total is 100× too big. Map the
// minor unit to its major ISO currency and divide.
const MINOR_UNITS: Record<string, { major: string; per: number }> = {
	GBp: { major: 'GBP', per: 100 }, // pence
	GBX: { major: 'GBP', per: 100 }, // pence (alt code)
	ZAc: { major: 'ZAR', per: 100 }, // South African cents
	ILA: { major: 'ILS', per: 100 }, // Israeli agorot
};

export function normalizeMinorUnit(
	currency: string,
	price: number,
	previousClose: number,
): { currency: string; price: number; previousClose: number } {
	const minor = MINOR_UNITS[currency];
	if (!minor) {
		return { currency, price, previousClose };
	}
	return {
		currency: minor.major,
		price: price / minor.per,
		previousClose: previousClose / minor.per,
	};
}

// FX pairs and futures (EURUSD=X, GC=F) are rates, not an amount denominated in
// a currency. Exclude them from currency-mixing checks and currency display so
// they can be used as conversion factors without muddying the result currency.
export function isFxLike(ticker: string): boolean {
	return ticker.includes('=');
}
