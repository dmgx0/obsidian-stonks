// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { HistoryCache, parseHistory } from '../src/history';
import { createApi } from '../src/api';
import { QuoteCache } from '../src/cache';

const mockUrl = vi.mocked(requestUrl);

function series(
	closes: Array<number | null>,
	currency = 'USD',
	startSec = 1_000,
) {
	return {
		status: 200,
		json: {
			chart: {
				result: [
					{
						meta: { currency },
						timestamp: closes.map((_c, i) => startSec + i * 86_400),
						indicators: { quote: [{ close: closes }] },
					},
				],
			},
		},
	};
}

beforeEach(() => {
	mockUrl.mockReset();
	vi.useFakeTimers();
	vi.setSystemTime(0);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('parseHistory', () => {
	it('maps timestamps to ms and drops null bars', () => {
		const h = parseHistory(
			'AAPL',
			'1mo',
			series([100, null, 102]).json,
		);
		expect(h?.points).toEqual([
			{ time: 1_000_000, close: 100 },
			{ time: (1_000 + 2 * 86_400) * 1000, close: 102 },
		]);
		expect(h?.currency).toBe('USD');
	});

	it('normalizes pence closes to pounds', () => {
		const h = parseHistory('LLOY.L', '1mo', series([5000, 5100], 'GBp').json);
		expect(h?.currency).toBe('GBP');
		expect(h?.points.map((p) => p.close)).toEqual([50, 51]);
	});

	it('returns null when there is no usable series', () => {
		expect(parseHistory('AAPL', '1mo', {})).toBeNull();
		expect(parseHistory('AAPL', '1mo', series([null, null]).json)).toBeNull();
	});
});

describe('HistoryCache', () => {
	it('fetches once within the TTL', async () => {
		mockUrl.mockResolvedValue(series([1, 2, 3]));
		const cache = new HistoryCache();
		const a = await cache.get('AAPL', '1mo');
		const b = await cache.get('AAPL', '1mo');
		expect(a?.points.length).toBe(3);
		expect(b).toBe(a);
		expect(mockUrl).toHaveBeenCalledTimes(1);
	});

	it('coalesces concurrent requests for the same key', async () => {
		mockUrl.mockResolvedValue(series([1, 2]));
		const cache = new HistoryCache();
		const [a, b] = await Promise.all([
			cache.get('AAPL', '1mo'),
			cache.get('AAPL', '1mo'),
		]);
		expect(a).toBe(b);
		expect(mockUrl).toHaveBeenCalledTimes(1);
	});

	it('returns null for an unknown symbol', async () => {
		mockUrl.mockResolvedValue({ status: 404, json: {} });
		const cache = new HistoryCache();
		expect(await cache.get('NOPE', '1mo')).toBeNull();
		expect(mockUrl).toHaveBeenCalledTimes(1); // notfound does not retry
	});

	it('keeps serving the last good series through a transient failure', async () => {
		mockUrl.mockResolvedValue(series([1, 2, 3]));
		const cache = new HistoryCache();
		const first = await cache.get('AAPL', '1mo');
		expect(first?.points.length).toBe(3);

		// Past the TTL, and the endpoint goes down (both hosts, both rounds —
		// advance timers through the retry backoff).
		vi.setSystemTime(2 * 60 * 60_000);
		mockUrl.mockResolvedValue({ status: 500, json: {} });
		const p = cache.get('AAPL', '1mo');
		await vi.advanceTimersByTimeAsync(600);
		expect(await p).toBe(first);
	});

	it('backs off after a failure instead of re-fetching every call', async () => {
		mockUrl.mockResolvedValue({ status: 500, json: {} });
		const cache = new HistoryCache();
		const p = cache.get('AAPL', '1mo');
		await vi.advanceTimersByTimeAsync(600); // through the retry backoff
		expect(await p).toBeNull();
		const callsAfterFirst = mockUrl.mock.calls.length;

		// Within the failure window: no new network activity at all.
		vi.setSystemTime(10_000);
		expect(await cache.get('AAPL', '1mo')).toBeNull();
		expect(mockUrl.mock.calls.length).toBe(callsAfterFirst);

		// After the window lapses, it tries again.
		vi.setSystemTime(60_000);
		mockUrl.mockResolvedValue(series([1, 2]));
		expect((await cache.get('AAPL', '1mo'))?.points.length).toBe(2);
	});
});

describe('api.getHistory', () => {
	it('normalizes the ticker and defaults to 1mo', async () => {
		mockUrl.mockResolvedValue(series([1, 2]));
		const api = createApi(
			new QuoteCache({ getQuotes: async () => new Map() }, 60_000),
			new HistoryCache(),
		);
		const h = await api.getHistory('  aapl ');
		expect(h?.ticker).toBe('AAPL');
		expect(h?.range).toBe('1mo');
		expect(mockUrl.mock.calls[0]?.[0]?.url).toContain('range=1mo');
	});

	it('rejects (not sync-throws) on an unknown range, so .catch() covers it', async () => {
		const api = createApi(
			new QuoteCache({ getQuotes: async () => new Map() }, 60_000),
			new HistoryCache(),
		);
		// Must be a rejection: user code does `api.getHistory(t, r).catch(...)`.
		let sync = true;
		try {
			const p = api.getHistory('AAPL', 'century' as never);
			sync = false;
			await expect(p).rejects.toThrow(/Unknown history range/);
		} finally {
			expect(sync).toBe(false);
		}
	});
});
