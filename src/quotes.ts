import { requestUrl } from 'obsidian';
import { ErrorReason, Quote, QuoteProvider, QuoteResult } from './types';
import { normalizeMinorUnit } from './currency';

// Unofficial endpoint (the same one Stock Blocks uses). It can change, rate-limit
// or block — so we retry, fall back to a second host, and report a typed reason
// per ticker. Documented in the README.
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

// Give up on a single request after this long, so a hung connection becomes a
// retryable `network` error instead of an eternal "…" inline.
const REQUEST_TIMEOUT_MS = 8000;

export interface YahooMeta {
	regularMarketPrice?: number;
	chartPreviousClose?: number;
	previousClose?: number;
	currency?: string;
}

export interface YahooChartResult {
	meta?: YahooMeta;
	timestamp?: number[];
	indicators?: { quote?: Array<{ close?: Array<number | null> }> };
}

export interface YahooChartResponse {
	chart?: { result?: YahooChartResult[] };
}

/** Outcome of one chart-endpoint fetch: parsed JSON or a typed failure. */
export type ChartFetch =
	| { ok: true; data: YahooChartResponse }
	| { ok: false; reason: ErrorReason };

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Reject if `promise` hasn't settled within `ms`. The timer is always cleared,
 *  and Promise.race keeps the slow promise handled (no unhandled rejection). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer = 0;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = window.setTimeout(
			() => reject(new Error('request timed out')),
			ms,
		);
	});
	return Promise.race([promise, timeout]).finally(() =>
		window.clearTimeout(timer),
	);
}

function toQuote(ticker: string, meta: YahooMeta, price: number): Quote {
	const rawPrev =
		typeof meta.chartPreviousClose === 'number'
			? meta.chartPreviousClose
			: typeof meta.previousClose === 'number'
				? meta.previousClose
				: price;
	// Normalize pence-style minor units (e.g. London GBp) to the major currency.
	const norm = normalizeMinorUnit(
		typeof meta.currency === 'string' ? meta.currency : '',
		price,
		rawPrev,
	);
	const change = norm.price - norm.previousClose;
	return {
		ticker,
		price: norm.price,
		currency: norm.currency,
		previousClose: norm.previousClose,
		change,
		changePct:
			norm.previousClose !== 0 ? (change / norm.previousClose) * 100 : 0,
		time: Date.now(),
	};
}

async function tryHost(
	host: string,
	ticker: string,
	query: string,
): Promise<ChartFetch> {
	try {
		const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
			ticker,
		)}?${query}`;
		// Always via requestUrl: bypasses CORS, works on mobile. Time-boxed
		// so a hung connection falls through to the `network` path below.
		const res = await withTimeout(
			requestUrl({ url, throw: false }),
			REQUEST_TIMEOUT_MS,
		);

		if (res.status === 429) {
			return { ok: false, reason: 'ratelimited' };
		}
		if (res.status === 404) {
			return { ok: false, reason: 'notfound' };
		}
		if (res.status !== 200) {
			return { ok: false, reason: 'network' };
		}
		return { ok: true, data: res.json as YahooChartResponse };
	} catch {
		return { ok: false, reason: 'network' };
	}
}

/** Fetch the chart endpoint for `ticker` with the given query string — two
 *  rounds over both hosts with a brief backoff. Shared by the quote provider
 *  and the history cache, so both get the same resilience. */
export async function fetchChart(
	ticker: string,
	query: string,
): Promise<ChartFetch> {
	let reason: ErrorReason = 'network';
	for (let attempt = 0; attempt < 2; attempt++) {
		for (const host of HOSTS) {
			const result = await tryHost(host, ticker, query);
			if (result.ok) {
				return result;
			}
			reason = result.reason;
			// A genuinely unknown symbol won't resolve on retry — stop early.
			if (reason === 'notfound') {
				return result;
			}
		}
		if (attempt === 0) {
			await sleep(500);
		}
	}
	return { ok: false, reason };
}

export class YahooProvider implements QuoteProvider {
	async getQuotes(tickers: string[]): Promise<Map<string, QuoteResult>> {
		const out = new Map<string, QuoteResult>();
		await Promise.all(
			tickers.map(async (ticker) => {
				out.set(ticker, await this.fetchOne(ticker));
			}),
		);
		return out;
	}

	private async fetchOne(ticker: string): Promise<QuoteResult> {
		const fetched = await fetchChart(ticker, 'interval=1d&range=1d');
		if (!fetched.ok) {
			return fetched;
		}
		const meta = fetched.data.chart?.result?.[0]?.meta;
		if (!meta || typeof meta.regularMarketPrice !== 'number') {
			// Valid response but no price → treat as an unknown symbol.
			return { ok: false, reason: 'notfound' };
		}
		return { ok: true, quote: toQuote(ticker, meta, meta.regularMarketPrice) };
	}
}
