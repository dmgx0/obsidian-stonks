import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuoteCache } from './cache';
import { Quote, QuoteProvider, QuoteResult } from './types';

function quote(ticker: string, price = 100): Quote {
	return {
		ticker,
		price,
		currency: 'USD',
		previousClose: price,
		change: 0,
		changePct: 0,
		time: 0,
	};
}

function okQuote(ticker: string, price = 100): QuoteResult {
	return { ok: true, quote: quote(ticker, price) };
}

class StubProvider implements QuoteProvider {
	calls = 0;
	constructor(private responses: Map<string, QuoteResult>) {}
	async getQuotes(tickers: string[]): Promise<Map<string, QuoteResult>> {
		this.calls++;
		const m = new Map<string, QuoteResult>();
		for (const t of tickers) {
			const r = this.responses.get(t);
			if (r) {
				m.set(t, r);
			}
		}
		return m;
	}
}

describe('QuoteCache', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('serves fresh hits without re-fetching', async () => {
		const provider = new StubProvider(new Map([['AAPL', okQuote('AAPL')]]));
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['AAPL']);
		await cache.get(['AAPL']);
		expect(provider.calls).toBe(1);
	});

	it('re-fetches after the TTL expires', async () => {
		const provider = new StubProvider(new Map([['AAPL', okQuote('AAPL')]]));
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['AAPL']);
		vi.setSystemTime(61_000);
		await cache.get(['AAPL']);
		expect(provider.calls).toBe(2);
	});

	it('coalesces concurrent requests for the same ticker', async () => {
		const provider = new StubProvider(new Map([['AAPL', okQuote('AAPL')]]));
		const cache = new QuoteCache(provider, 60_000);
		await Promise.all([cache.get(['AAPL']), cache.get(['AAPL'])]);
		expect(provider.calls).toBe(1);
	});

	it('caches not-found far longer than the success TTL', async () => {
		const provider = new StubProvider(
			new Map<string, QuoteResult>([
				['NOPE', { ok: false, reason: 'notfound' }],
			]),
		);
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['NOPE']);
		vi.setSystemTime(61_000); // past success TTL, well within not-found TTL
		await cache.get(['NOPE']);
		expect(provider.calls).toBe(1);
	});

	it('retries a rate-limit sooner than a success', async () => {
		const provider = new StubProvider(
			new Map<string, QuoteResult>([
				['AAPL', { ok: false, reason: 'ratelimited' }],
			]),
		);
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['AAPL']);
		vi.setSystemTime(21_000); // past the 20s rate-limit TTL
		await cache.get(['AAPL']);
		expect(provider.calls).toBe(2);
	});

	it('lastUpdated reflects only successful fetches', async () => {
		const provider = new StubProvider(
			new Map<string, QuoteResult>([
				['NOPE', { ok: false, reason: 'notfound' }],
			]),
		);
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['NOPE']);
		expect(cache.lastUpdated()).toBeNull();
	});

	it('snapshot exports only ok quotes', async () => {
		const provider = new StubProvider(
			new Map<string, QuoteResult>([
				['AAPL', okQuote('AAPL', 100)],
				['NOPE', { ok: false, reason: 'notfound' }],
			]),
		);
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['AAPL', 'NOPE']);
		const snap = cache.snapshot();
		expect(Object.keys(snap)).toEqual(['AAPL']);
		expect(snap.AAPL?.price).toBe(100);
	});

	it('seed pre-populates a quote without fetching', () => {
		const cache = new QuoteCache(new StubProvider(new Map()), 60_000);
		cache.seed({ AAPL: quote('AAPL', 123) });
		const r = cache.peek('AAPL');
		expect(r?.ok && r.quote.price).toBe(123);
	});

	it('keeps the last good quote on a transient failure', async () => {
		const responses = new Map<string, QuoteResult>([
			['AAPL', okQuote('AAPL', 100)],
		]);
		const provider = new StubProvider(responses);
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['AAPL']);
		responses.set('AAPL', { ok: false, reason: 'network' }); // go offline
		vi.setSystemTime(61_000); // stale → refetch, which now fails
		const r = (await cache.get(['AAPL'])).get('AAPL');
		expect(r?.ok && r.quote.price).toBe(100);
	});

	it('still overwrites a good quote with a genuine notfound', async () => {
		const responses = new Map<string, QuoteResult>([
			['AAPL', okQuote('AAPL', 100)],
		]);
		const provider = new StubProvider(responses);
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['AAPL']);
		responses.set('AAPL', { ok: false, reason: 'notfound' });
		vi.setSystemTime(61_000);
		const r = (await cache.get(['AAPL'])).get('AAPL');
		expect(r).toEqual({ ok: false, reason: 'notfound' });
	});

	it('notifies subscribers when fresh quotes arrive', async () => {
		const provider = new StubProvider(new Map([['AAPL', okQuote('AAPL')]]));
		const cache = new QuoteCache(provider, 60_000);
		let a = 0;
		let b = 0;
		cache.subscribe(() => a++);
		cache.subscribe(() => b++);
		await cache.get(['AAPL']);
		expect(a).toBe(1);
		expect(b).toBe(1);
		// A fresh cache hit fetches nothing → no notification.
		await cache.get(['AAPL']);
		expect(a).toBe(1);
	});

	it('stops notifying after unsubscribe', async () => {
		const provider = new StubProvider(new Map([['AAPL', okQuote('AAPL')]]));
		const cache = new QuoteCache(provider, 60_000);
		let fired = 0;
		const unsubscribe = cache.subscribe(() => fired++);
		await cache.get(['AAPL']);
		unsubscribe();
		vi.setSystemTime(61_000);
		await cache.get(['AAPL']);
		expect(fired).toBe(1);
	});

	it('isolates a throwing listener: fetch resolves, later listeners fire', async () => {
		const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
		const provider = new StubProvider(new Map([['AAPL', okQuote('AAPL')]]));
		const cache = new QuoteCache(provider, 60_000);
		let after = 0;
		cache.subscribe(() => {
			throw new Error('third-party listener bug');
		});
		cache.subscribe(() => after++);
		// Must not reject (the old loop propagated into the fetch promise).
		const r = (await cache.get(['AAPL'])).get('AAPL');
		expect(r?.ok).toBe(true);
		expect(after).toBe(1);
		expect(quiet).toHaveBeenCalled();
		quiet.mockRestore();
	});

	it('lists tickers with good quotes for autocomplete', async () => {
		const provider = new StubProvider(
			new Map<string, QuoteResult>([
				['AAPL', okQuote('AAPL')],
				['NOPE', { ok: false, reason: 'notfound' }],
			]),
		);
		const cache = new QuoteCache(provider, 60_000);
		await cache.get(['AAPL', 'NOPE']);
		expect(cache.tickers()).toEqual(['AAPL']);
	});

	it('does not notify when a fetch yields only errors', async () => {
		const provider = new StubProvider(
			new Map<string, QuoteResult>([
				['NOPE', { ok: false, reason: 'notfound' }],
			]),
		);
		const cache = new QuoteCache(provider, 60_000);
		let fired = 0;
		cache.subscribe(() => fired++);
		await cache.get(['NOPE']);
		expect(fired).toBe(0);
	});
});
