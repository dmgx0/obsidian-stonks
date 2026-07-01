import { Quote } from './types';
import { QuoteCache } from './cache';
import {
	History,
	HistoryCache,
	HistoryRange,
	HISTORY_RANGES,
} from './history';

/**
 * Public API surface, reachable from DataviewJS / Templater / JS Engine:
 *
 *   const stonks = app.plugins.plugins['stonks'].api;
 *   const q = await stonks.getQuote('VWRA.L');
 *   // q.price ... do your own portfolio math here.
 *
 * This is the thing DataviewJS `fetch` cannot do on mobile (CORS) — quotes
 * come through Obsidian's requestUrl. We never compute the user's portfolio;
 * we just hand back raw, cached quotes.
 */
export interface StonksAPI {
	/** One ticker; null if it can't be resolved. Cached + TTL like everything else. */
	getQuote(ticker: string): Promise<Quote | null>;
	/** Many tickers at once; resolved entries only. */
	getQuotes(tickers: string[]): Promise<Map<string, Quote>>;
	/** Force-refresh every ticker seen so far. */
	refresh(): Promise<void>;
	/** Epoch ms of the most recent fetch, or null if nothing fetched yet. */
	lastUpdated(): number | null;
	/**
	 * Subscribe to quote updates; returns an unsubscribe function. Fires after
	 * fresh quotes land (background refresh, another note's fetch, a manual
	 * refresh) — re-read via getQuote/getQuotes inside the listener (cheap: it
	 * hits the cache). Notifications may come in bursts; guard re-renders with
	 * a busy flag. Unsubscribe when your view goes away, e.g. when your
	 * container element is no longer `isConnected`.
	 */
	onQuotes(listener: () => void): () => void;
	/**
	 * Historical closes for sparklines and charts drawn by YOUR code
	 * (DataviewJS, Obsidian Charts, JS Engine) — Stonks itself stays chartless.
	 * Ranges: '1d' '5d' '1mo' '3mo' '6mo' '1y' '2y' '5y' 'ytd' 'max'
	 * (default '1mo'). Cached ~5 min for intraday ranges, ~1 h otherwise;
	 * null when the symbol can't be fetched. An unknown range REJECTS the
	 * returned promise (so `.catch()` / try-await both cover it).
	 */
	getHistory(ticker: string, range?: HistoryRange): Promise<History | null>;
}

const norm = (t: string): string => t.trim().toUpperCase();

export function createApi(cache: QuoteCache, history: HistoryCache): StonksAPI {
	return {
		async getQuote(ticker) {
			const sym = norm(ticker);
			const result = (await cache.get([sym])).get(sym);
			return result && result.ok ? result.quote : null;
		},
		async getQuotes(tickers) {
			const results = await cache.get(tickers.map(norm));
			const out = new Map<string, Quote>();
			for (const [sym, result] of results) {
				if (result.ok) {
					out.set(sym, result.quote);
				}
			}
			return out;
		},
		refresh() {
			return cache.refreshAll();
		},
		lastUpdated() {
			return cache.lastUpdated();
		},
		onQuotes(listener) {
			return cache.subscribe(listener);
		},
		// async so the validation error is a rejection, not a synchronous
		// throw — callers' `.catch()` handles every failure mode uniformly.
		async getHistory(ticker, range = '1mo') {
			if (!HISTORY_RANGES.includes(range)) {
				throw new Error(
					`Unknown history range "${range}" — use one of ${HISTORY_RANGES.join(', ')}`,
				);
			}
			return history.get(norm(ticker), range);
		},
	};
}
