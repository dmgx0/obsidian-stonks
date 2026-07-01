import { Quote, QuoteProvider, QuoteResult } from './types';

// No Obsidian imports here (the provider is injected) so the cache is
// unit-testable in plain Node.

interface CacheEntry {
	result: QuoteResult;
	fetchedAt: number;
}

// Errors get their own (shorter) freshness windows: retry a rate-limit / blip
// soon, but don't re-hammer Yahoo for a symbol that simply doesn't exist.
const NOTFOUND_TTL_MS = 300_000;
const RATELIMIT_TTL_MS = 20_000;
const NETWORK_TTL_MS = 10_000;

function unique(items: string[]): string[] {
	return [...new Set(items)];
}

/** TTL cache over a QuoteProvider, with in-flight coalescing so a note full of
 *  the same ticker fires one request, not one per inline span. */
export class QuoteCache {
	private entries = new Map<string, CacheEntry>();
	private inFlight = new Map<string, Promise<void>>();
	private listeners = new Set<() => void>();

	constructor(
		private provider: QuoteProvider,
		private ttlMs: number,
	) {}

	/** Subscribe to "new successful quotes were stored". Used for persistence
	 *  and exposed through the public API (`api.onQuotes`) so other plugins'
	 *  dashboards can re-render live. Returns an unsubscribe function.
	 *  Notifications can come in bursts (one per fetch batch); re-reading
	 *  through get()/peek() inside a listener is cheap because it hits cache. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	setTtl(ms: number): void {
		this.ttlMs = ms;
	}

	/** Synchronous read of whatever is cached (success or error), for instant
	 *  first paint while a refresh is in flight. */
	peek(ticker: string): QuoteResult | undefined {
		return this.entries.get(ticker)?.result;
	}

	private ttlFor(result: QuoteResult): number {
		if (result.ok) {
			return this.ttlMs;
		}
		if (result.reason === 'ratelimited') {
			return RATELIMIT_TTL_MS;
		}
		if (result.reason === 'network') {
			return NETWORK_TTL_MS;
		}
		return NOTFOUND_TTL_MS;
	}

	private isFresh(entry: CacheEntry): boolean {
		return Date.now() - entry.fetchedAt < this.ttlFor(entry.result);
	}

	/** Resolve results for these tickers, fetching only the missing or stale. */
	async get(tickers: string[]): Promise<Map<string, QuoteResult>> {
		const wanted = unique(tickers);
		const stale = wanted.filter((t) => {
			const e = this.entries.get(t);
			return !e || !this.isFresh(e);
		});
		if (stale.length > 0) {
			await this.ensureFetch(stale);
		}

		const out = new Map<string, QuoteResult>();
		for (const t of wanted) {
			const e = this.entries.get(t);
			if (e) {
				out.set(t, e.result);
			}
		}
		return out;
	}

	/** Force-refresh every ticker seen so far (background auto-refresh). */
	async refreshAll(): Promise<void> {
		const all = [...this.entries.keys()];
		if (all.length > 0) {
			await this.runFetch(all);
		}
	}

	/** Tickers with a good cached quote (cheap; for autocomplete). */
	tickers(): string[] {
		const out: string[] = [];
		for (const [ticker, e] of this.entries) {
			if (e.result.ok) {
				out.push(ticker);
			}
		}
		return out;
	}

	/** Epoch ms of the most recent *successful* fetch, or null. */
	lastUpdated(): number | null {
		let max: number | null = null;
		for (const e of this.entries.values()) {
			if (e.result.ok && (max === null || e.fetchedAt > max)) {
				max = e.fetchedAt;
			}
		}
		return max;
	}

	/** Export the most-recent good quotes (capped) for persistence. */
	snapshot(maxEntries = 500): Record<string, Quote> {
		const ok: Array<{ ticker: string; quote: Quote; at: number }> = [];
		for (const [ticker, e] of this.entries) {
			if (e.result.ok) {
				ok.push({ ticker, quote: e.result.quote, at: e.fetchedAt });
			}
		}
		ok.sort((a, b) => b.at - a.at);
		const out: Record<string, Quote> = {};
		for (const { ticker, quote } of ok.slice(0, maxEntries)) {
			out[ticker] = quote;
		}
		return out;
	}

	/** Pre-seed persisted quotes where nothing is cached yet. They keep their
	 *  original fetch time, so they paint instantly but refresh on first access. */
	seed(quotes: Record<string, Quote>): void {
		for (const [ticker, quote] of Object.entries(quotes)) {
			if (!this.entries.has(ticker) && typeof quote?.price === 'number') {
				this.entries.set(ticker, {
					result: { ok: true, quote },
					fetchedAt: quote.time ?? 0,
				});
			}
		}
	}

	private ensureFetch(tickers: string[]): Promise<void> {
		const joins: Array<Promise<void>> = [];
		const toFetch: string[] = [];
		for (const t of tickers) {
			const existing = this.inFlight.get(t);
			if (existing) {
				joins.push(existing);
			} else {
				toFetch.push(t);
			}
		}
		if (toFetch.length > 0) {
			const p = this.runFetch(toFetch).finally(() => {
				for (const t of toFetch) {
					this.inFlight.delete(t);
				}
			});
			for (const t of toFetch) {
				this.inFlight.set(t, p);
			}
			joins.push(p);
		}
		return Promise.all(joins).then(() => undefined);
	}

	private async runFetch(tickers: string[]): Promise<void> {
		const fetched = await this.provider.getQuotes(tickers);
		const now = Date.now();
		let gotNew = false;
		for (const t of tickers) {
			const result = fetched.get(t);
			if (!result) {
				continue;
			}
			const existing = this.entries.get(t);
			// On a transient failure (offline / rate-limit), keep the last good
			// quote rather than replacing it with an error — basic offline
			// resilience. A genuine `notfound` still overwrites.
			if (
				!result.ok &&
				(result.reason === 'network' ||
					result.reason === 'ratelimited') &&
				existing?.result.ok
			) {
				this.entries.set(t, { result: existing.result, fetchedAt: now });
				continue;
			}
			this.entries.set(t, { result, fetchedAt: now });
			if (result.ok) {
				gotNew = true;
			}
		}
		if (gotNew) {
			// Copy first: a listener may unsubscribe (or subscribe) while firing.
			// Isolate each: subscribe() is public API surface (api.onQuotes), and
			// a throwing third-party listener must not reject the shared fetch
			// promise (which would error healthy spans) or starve later listeners.
			for (const listener of [...this.listeners]) {
				try {
					listener();
				} catch (e) {
					console.error('Stonks: onQuotes listener threw', e);
				}
			}
		}
	}
}
