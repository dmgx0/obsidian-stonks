import { describe, it, expect } from 'vitest';
import {
	formatNumber,
	formatCurrency,
	formatPercent,
	formatCompact,
} from './format';

const L = 'en-US'; // pin the locale so assertions are deterministic

describe('formatNumber', () => {
	it('groups and fixes decimals', () => {
		expect(formatNumber(1234.5, 2, L)).toBe('1,234.50');
	});
});

describe('formatCurrency', () => {
	it('formats with the currency symbol', () => {
		expect(formatCurrency(275.15, 'USD', 2, { locale: L })).toBe('$275.15');
	});

	it('adds a + for gains when signed (negatives keep their -)', () => {
		expect(formatCurrency(1.5, 'USD', 2, { signed: true, locale: L })).toBe(
			'+$1.50',
		);
		expect(formatCurrency(-2, 'USD', 2, { signed: true, locale: L })).toBe(
			'-$2.00',
		);
	});

	it('falls back to "number CODE" for an unknown currency', () => {
		expect(formatCurrency(50, 'XYZ?', 2, { locale: L })).toBe('50.00 XYZ?');
	});

	it('is a plain number when there is no currency', () => {
		expect(formatCurrency(50, '', 2, { locale: L })).toBe('50.00');
	});
});

describe('formatPercent', () => {
	it('signs by default and appends %', () => {
		expect(formatPercent(6.15, 2, { locale: L })).toBe('+6.15%');
		expect(formatPercent(-6.15, 2, { locale: L })).toBe('-6.15%');
	});

	it('can omit the + sign', () => {
		expect(formatPercent(6.15, 2, { signed: false, locale: L })).toBe(
			'6.15%',
		);
	});
});

describe('formatCompact', () => {
	it('shortens large numbers', () => {
		expect(formatCompact(1_200_000, L)).toBe('1.2M');
		expect(formatCompact(2_500_000_000, L)).toBe('2.5B');
	});
});
