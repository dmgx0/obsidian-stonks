import { describe, it, expect } from 'vitest';
import { normalizeMinorUnit, isFxLike } from './currency';

describe('normalizeMinorUnit', () => {
	it('converts GBp (pence) to GBP, dividing by 100', () => {
		expect(normalizeMinorUnit('GBp', 5000, 4900)).toEqual({
			currency: 'GBP',
			price: 50,
			previousClose: 49,
		});
	});

	it('treats GBX as pence too', () => {
		expect(normalizeMinorUnit('GBX', 200, 200).currency).toBe('GBP');
		expect(normalizeMinorUnit('GBX', 200, 200).price).toBe(2);
	});

	it('leaves a normal currency untouched', () => {
		expect(normalizeMinorUnit('USD', 184.21, 185)).toEqual({
			currency: 'USD',
			price: 184.21,
			previousClose: 185,
		});
	});
});

describe('isFxLike', () => {
	it('flags FX pairs and futures', () => {
		expect(isFxLike('EURUSD=X')).toBe(true);
		expect(isFxLike('GC=F')).toBe(true);
	});

	it('is false for ordinary tickers', () => {
		expect(isFxLike('AAPL')).toBe(false);
		expect(isFxLike('VWRA.L')).toBe(false);
		expect(isFxLike('BTC-USD')).toBe(false);
	});
});
