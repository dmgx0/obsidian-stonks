// Shared types and default settings. No Obsidian imports here so this stays
// trivially testable.

/** A single resolved quote for a ticker. */
export interface Quote {
	ticker: string;
	/** Latest price in the quote's native currency. */
	price: number;
	/** ISO currency code reported by the source (may be empty if unknown). */
	currency: string;
	/** Previous close, used for the day change. */
	previousClose: number;
	/** Absolute day change (price - previousClose). */
	change: number;
	/** Day change as a percentage. */
	changePct: number;
	/** Epoch milliseconds when this quote was fetched. */
	time: number;
}

/** Why a single ticker failed to resolve — drives distinct inline states. */
export type ErrorReason = 'notfound' | 'ratelimited' | 'network';

/** Per-ticker fetch outcome. Errors are first-class so the UI can tell an
 *  unknown symbol apart from a rate-limit or an offline blip. */
export type QuoteResult =
	| { ok: true; quote: Quote }
	| { ok: false; reason: ErrorReason };

/** Swappable quote source. Ship YahooProvider only; keep the seam so a keyed
 *  provider (Finnhub / Alpha Vantage) can drop in later. */
export interface QuoteProvider {
	getQuotes(tickers: string[]): Promise<Map<string, QuoteResult>>;
}

export interface StonksSettings {
	/** Inline trigger prefix. Default "$:" — distinct from Dataview (`=`/`$=`)
	 *  and Numerals (`#:`) so the three coexist without fighting over spans. */
	prefix: string;
	/** How long a fetched quote stays fresh before a re-fetch, in seconds. */
	cacheTtlSeconds: number;
	/** Auto-refresh interval in seconds. 0 disables the background refresh. */
	refreshIntervalSeconds: number;
	/** Decimal places for rendered expression results. */
	decimals: number;
	/** Path to a note whose frontmatter provides vault-wide @variables.
	 *  Empty = none. Note-local properties always win. */
	variablesNote: string;
}

export const DEFAULT_SETTINGS: StonksSettings = {
	prefix: '$:',
	cacheTtlSeconds: 60,
	refreshIntervalSeconds: 300,
	decimals: 2,
	variablesNote: '',
};

/** Shape persisted to data.json: settings plus the last good quotes, so a
 *  reopened note shows values instantly (and survives a brief offline spell)
 *  before the background refresh lands. */
export interface PersistedData {
	settings: StonksSettings;
	quotes: Record<string, Quote>;
}
