// Historical close series for the public API. Stonks itself stays chartless —
// this hands raw points to whatever wants to draw (DataviewJS, Obsidian
// Charts, JS Engine). Same Yahoo v8 chart endpoint as quotes, same host
// fallback + timeout via fetchChart, its own longer-lived cache.

import { normalizeMinorUnit } from './currency';
import { fetchChart, YahooChartResponse } from './quotes';

export const HISTORY_RANGES = [
	'1d',
	'5d',
	'1mo',
	'3mo',
	'6mo',
	'1y',
	'2y',
	'5y',
	'ytd',
	'max',
] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export interface HistoryPoint {
	/** Epoch milliseconds. */
	time: number;
	/** Close in the major currency (pence already normalized). */
	close: number;
}

export interface History {
	ticker: string;
	currency: string;
	range: HistoryRange;
	/** Chronological; null bars (halts / gaps) already dropped. */
	points: HistoryPoint[];
}

// Bar size per range: fine enough to draw, coarse enough to stay small.
const INTERVAL: Record<HistoryRange, string> = {
	'1d': '5m',
	'5d': '30m',
	'1mo': '1d',
	'3mo': '1d',
	'6mo': '1d',
	'1y': '1d',
	'2y': '1wk',
	'5y': '1wk',
	ytd: '1d',
	max: '1mo',
};

// History moves slowly — cache it much longer than quotes. Intraday ranges
// track the live market, so they refresh sooner than daily/weekly ones.
const INTRADAY_TTL_MS = 5 * 60_000;
const DAILY_TTL_MS = 60 * 60_000;
// After a failed fetch, don't retry the network for this long — a redrawing
// dashboard would otherwise re-run the full multi-host retry cycle (with its
// 8 s timeouts) on every draw while offline.
const FAILURE_TTL_MS = 30_000;
const MAX_ENTRIES = 200;

function ttlFor(range: HistoryRange): number {
	return range === '1d' || range === '5d' ? INTRADAY_TTL_MS : DAILY_TTL_MS;
}

/** Parse a chart response into a History; null when there is no usable series.
 *  Exported for tests. */
export function parseHistory(
	ticker: string,
	range: HistoryRange,
	data: YahooChartResponse,
): History | null {
	const result = data.chart?.result?.[0];
	const times = result?.timestamp;
	const closes = result?.indicators?.quote?.[0]?.close;
	if (!result || !Array.isArray(times) || !Array.isArray(closes)) {
		return null;
	}
	const rawCurrency =
		typeof result.meta?.currency === 'string' ? result.meta.currency : '';
	const points: HistoryPoint[] = [];
	for (let i = 0; i < times.length && i < closes.length; i++) {
		const t = times[i];
		const c = closes[i];
		if (typeof t === 'number' && typeof c === 'number' && Number.isFinite(c)) {
			points.push({
				time: t * 1000,
				close: normalizeMinorUnit(rawCurrency, c, 0).price,
			});
		}
	}
	if (points.length === 0) {
		return null;
	}
	return {
		ticker,
		range,
		currency: normalizeMinorUnit(rawCurrency, 0, 0).currency,
		points,
	};
}

/** TTL cache over ranged chart fetches, with in-flight coalescing. Not
 *  persisted (series are bulky and cheap to refetch); a transient failure
 *  keeps serving the last good series. */
export class HistoryCache {
	private entries = new Map<
		string,
		{ history: History; fetchedAt: number }
	>();
	private inFlight = new Map<string, Promise<History | null>>();
	private failedAt = new Map<string, number>();

	async get(ticker: string, range: HistoryRange): Promise<History | null> {
		const key = `${ticker}:${range}`;
		const hit = this.entries.get(key);
		if (hit && Date.now() - hit.fetchedAt < ttlFor(range)) {
			return hit.history;
		}
		// Inside the failure window, don't hit the network again — serve the
		// stale series (or nothing) until the backoff lapses.
		const failed = this.failedAt.get(key);
		if (failed !== undefined && Date.now() - failed < FAILURE_TTL_MS) {
			return hit?.history ?? null;
		}
		const flying = this.inFlight.get(key);
		if (flying) {
			return flying;
		}
		const p = this.fetch(ticker, range, key).finally(() =>
			this.inFlight.delete(key),
		);
		this.inFlight.set(key, p);
		return p;
	}

	private async fetch(
		ticker: string,
		range: HistoryRange,
		key: string,
	): Promise<History | null> {
		const fetched = await fetchChart(
			ticker,
			`interval=${INTERVAL[range]}&range=${range}`,
		);
		const parsed = fetched.ok ? parseHistory(ticker, range, fetched.data) : null;
		if (!parsed) {
			// Transient failure or empty payload: back off, keep any stale series.
			this.failedAt.set(key, Date.now());
			return this.entries.get(key)?.history ?? null;
		}
		this.failedAt.delete(key);
		// Delete-then-set so a refresh moves the key to the end of the Map's
		// insertion order — eviction below is LRU-ish, not FIFO-by-first-fetch
		// (which would evict the hottest, constantly-refreshed series first).
		this.entries.delete(key);
		this.entries.set(key, { history: parsed, fetchedAt: Date.now() });
		while (this.entries.size > MAX_ENTRIES) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.entries.delete(oldest);
		}
		return parsed;
	}
}
