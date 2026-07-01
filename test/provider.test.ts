// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { YahooProvider } from '../src/quotes';

const mockUrl = vi.mocked(requestUrl);

function chart(meta: Record<string, unknown>) {
	return { status: 200, json: { chart: { result: [{ meta }] } } };
}

async function fetchOne(ticker: string) {
	return (await new YahooProvider().getQuotes([ticker])).get(ticker);
}

beforeEach(() => {
	mockUrl.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('YahooProvider', () => {
	it('returns an ok quote on 200', async () => {
		mockUrl.mockResolvedValue(
			chart({
				regularMarketPrice: 275.15,
				chartPreviousClose: 293.17,
				currency: 'USD',
			}),
		);
		const r = await fetchOne('AAPL');
		expect(r?.ok).toBe(true);
		if (r?.ok) {
			expect(r.quote.price).toBe(275.15);
			expect(r.quote.currency).toBe('USD');
			expect(r.quote.change).toBeCloseTo(275.15 - 293.17);
		}
	});

	it('normalizes GBp pence to GBP (÷100)', async () => {
		mockUrl.mockResolvedValue(
			chart({
				regularMarketPrice: 5000,
				chartPreviousClose: 4900,
				currency: 'GBp',
			}),
		);
		const r = await fetchOne('LLOY.L');
		expect(r?.ok && r.quote.currency).toBe('GBP');
		expect(r?.ok && r.quote.price).toBe(50);
	});

	it('reports notfound on 404 without retrying', async () => {
		mockUrl.mockResolvedValue({ status: 404, json: {} });
		const r = await fetchOne('NOPE');
		expect(r).toEqual({ ok: false, reason: 'notfound' });
		expect(mockUrl).toHaveBeenCalledTimes(1);
	});

	it('reports notfound on a 200 with no price', async () => {
		mockUrl.mockResolvedValue({
			status: 200,
			json: { chart: { result: [{ meta: {} }] } },
		});
		expect(await fetchOne('NOPE')).toEqual({
			ok: false,
			reason: 'notfound',
		});
	});

	it('falls back to query2 when query1 errors', async () => {
		mockUrl
			.mockResolvedValueOnce({ status: 500, json: {} })
			.mockResolvedValueOnce(
				chart({ regularMarketPrice: 100, currency: 'USD' }),
			);
		const r = await fetchOne('AAPL');
		expect(r?.ok).toBe(true);
		expect(mockUrl).toHaveBeenCalledTimes(2);
	});

	it('reports ratelimited after exhausting both hosts and a retry', async () => {
		mockUrl.mockResolvedValue({ status: 429, json: {} });
		const r = await fetchOne('AAPL');
		expect(r).toEqual({ ok: false, reason: 'ratelimited' });
		expect(mockUrl).toHaveBeenCalledTimes(4); // 2 hosts × 2 rounds
	});

	it('reports network on a thrown error', async () => {
		mockUrl.mockRejectedValue(new Error('offline'));
		expect(await fetchOne('AAPL')).toEqual({
			ok: false,
			reason: 'network',
		});
	});

	it('times out a hung request and reports network', async () => {
		vi.useFakeTimers();
		mockUrl.mockReturnValue(new Promise(() => {})); // never resolves
		const r = fetchOne('AAPL');
		await vi.runAllTimersAsync();
		expect(await r).toEqual({ ok: false, reason: 'network' });
	});
});
