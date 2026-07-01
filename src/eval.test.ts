import { describe, it, expect } from 'vitest';
import { parseExpression, ExprError } from './eval';

const prices = new Map<string, number>([
	['VWRA.L', 100],
	['MSFT', 400],
	['BTC-USD', 50000],
	['BRK-B', 300],
	['EURUSD=X', 1.08],
]);

const priceResolver = (sym: string): number => {
	const p = prices.get(sym);
	if (p === undefined) {
		throw new ExprError(`no ${sym}`);
	}
	return p;
};

const evalStr = (s: string) => parseExpression(s).evaluate(priceResolver);

describe('parseExpression', () => {
	it('resolves a bare ticker to its price', () => {
		expect(evalStr('VWRA.L')).toBe(100);
	});

	it('flags a single bare ticker (price field) for formatting', () => {
		expect(parseExpression('VWRA.L').single).toEqual({
			sym: 'VWRA.L',
			field: 'price',
		});
		expect(parseExpression('VWRA.L * 2').single).toBeNull();
	});

	it('parses dot-notation fields', () => {
		expect(parseExpression('AAPL.change').single).toEqual({
			sym: 'AAPL',
			field: 'change',
		});
		expect(parseExpression('VWRA.L.pct').single).toEqual({
			sym: 'VWRA.L',
			field: 'pct',
		});
		expect(parseExpression('AAPL.prev').tickers).toEqual(['AAPL']);
	});

	it('resolves the requested field and dedupes by symbol', () => {
		const parsed = parseExpression('AAPL.change + AAPL.pct');
		expect(parsed.tickers).toEqual(['AAPL']);
		const val = parsed.evaluate((_sym, field) =>
			field === 'change' ? 5 : field === 'pct' ? 2 : 100,
		);
		expect(val).toBe(7);
	});

	it('keeps the dotted exchange suffix as part of the ticker', () => {
		const parsed = parseExpression('VWRA.L');
		expect(parsed.tickers).toEqual(['VWRA.L']);
	});

	it('does arithmetic over a ticker and literals', () => {
		expect(evalStr('VWRA.L * 100 + 500')).toBe(10500);
	});

	it('handles multiple tickers', () => {
		expect(evalStr('VWRA.L * 100 + MSFT * 5')).toBe(12000);
		expect(parseExpression('VWRA.L + MSFT').tickers).toEqual([
			'VWRA.L',
			'MSFT',
		]);
	});

	it('respects operator precedence and parentheses', () => {
		expect(evalStr('2 + 3 * 4')).toBe(14);
		expect(evalStr('(2 + 3) * 4')).toBe(20);
	});

	it('supports unary minus vs binary minus', () => {
		expect(evalStr('-MSFT + 500')).toBe(100);
		expect(evalStr('500 - MSFT')).toBe(100);
	});

	it('uppercases tickers so cache keys are stable', () => {
		expect(evalStr('msft')).toBe(400);
		expect(parseExpression('msft').tickers).toEqual(['MSFT']);
	});

	it('handles dash pairs and class shares without spaces', () => {
		expect(evalStr('BTC-USD')).toBe(50000);
		expect(evalStr('BRK-B * 2')).toBe(600);
	});

	it('tokenizes FX pairs with the =X suffix', () => {
		expect(parseExpression('EURUSD=X').tickers).toEqual(['EURUSD=X']);
		expect(parseExpression('AAPL / EURUSD=X').tickers).toEqual([
			'AAPL',
			'EURUSD=X',
		]);
		expect(evalStr('MSFT * EURUSD=X')).toBeCloseTo(432);
	});

	it('throws on a missing price', () => {
		expect(() => evalStr('NOPE')).toThrow(ExprError);
	});

	it('throws on malformed input', () => {
		expect(() => parseExpression('VWRA.L *')).toThrow(ExprError);
		expect(() => parseExpression('(1 + 2')).toThrow(ExprError);
		expect(() => parseExpression('')).toThrow(ExprError);
	});

	it('deduplicates repeated tickers', () => {
		expect(parseExpression('MSFT + MSFT').tickers).toEqual(['MSFT']);
		expect(evalStr('MSFT + MSFT')).toBe(800);
	});
});
