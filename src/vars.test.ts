import { describe, it, expect } from 'vitest';
import { expandVariables, VarLookup } from './vars';
import { parseExpression } from './eval';

const lookup =
	(vars: Record<string, string | number>): VarLookup =>
	(name) =>
		vars[name];

describe('expandVariables', () => {
	it('passes an @-free expression through untouched', () => {
		expect(expandVariables('AAPL * 25', lookup({}))).toBe('AAPL * 25');
	});

	it('substitutes a number property as a parenthesised literal', () => {
		expect(expandVariables('AAPL * @qty', lookup({ qty: 25 }))).toBe(
			'AAPL * (25)',
		);
	});

	it('substitutes a string property as a sub-expression (alias)', () => {
		expect(
			expandVariables('@portfolio - 100', lookup({ portfolio: 'A + B' })),
		).toBe('(A + B) - 100');
	});

	it('keeps precedence via the parens (end-to-end with the parser)', () => {
		// Without wrapping, "1 + 2 * 2" would bind differently.
		const expanded = expandVariables('@p * 2', lookup({ p: '1 + 2' }));
		const value = parseExpression(expanded).evaluate(() => 0);
		expect(value).toBe(6);
	});

	it('expands nested variables', () => {
		const vars = { total: '@a + @b', a: 10, b: '@c * 2', c: 3 };
		expect(expandVariables('@total', lookup(vars))).toBe(
			'((10) + ((3) * 2))',
		);
	});

	it('handles negative numbers safely', () => {
		const expanded = expandVariables('10 - @adj', lookup({ adj: -5 }));
		const value = parseExpression(expanded).evaluate(() => 0);
		expect(value).toBe(15);
	});

	it('allows dashes and underscores in names', () => {
		expect(
			expandVariables(
				'@qty-aapl + @cost_basis',
				lookup({ 'qty-aapl': 1, cost_basis: 2 }),
			),
		).toBe('(1) + (2)');
	});

	it('substitutes multiple occurrences', () => {
		expect(expandVariables('@q + @q', lookup({ q: 2 }))).toBe('(2) + (2)');
	});

	it('throws on an unknown variable', () => {
		expect(() => expandVariables('@nope', lookup({}))).toThrow(
			/Unknown variable/,
		);
	});

	it('throws on a circular alias', () => {
		expect(() =>
			expandVariables('@a', lookup({ a: '@b', b: '@a' })),
		).toThrow(/Circular/);
	});

	it('throws on non-number/string values', () => {
		const bad: VarLookup = (name) => (name === 'flag' ? true : undefined);
		expect(() => expandVariables('@flag', bad)).toThrow(/number or text/);
		expect(() =>
			expandVariables('@inf', lookup({ inf: Infinity })),
		).toThrow(/finite/);
	});

	it('renders tiny numbers without exponential notation', () => {
		// String(1e-7) is "1e-7" — the tokenizer would read `e-7` as a ticker.
		const expanded = expandVariables('BTC * @sats', lookup({ sats: 1e-7 }));
		expect(expanded).toBe('BTC * (0.0000001)');
		const v = parseExpression(expanded).evaluate(() => 2);
		expect(v).toBeCloseTo(2e-7);
	});

	it('rejects astronomically large numbers instead of leaking e-notation', () => {
		expect(() => expandVariables('@n', lookup({ n: 1e22 }))).toThrow(
			/too large/,
		);
	});
});

describe('readVar / mergeVars', () => {
	it('reads exact then case-insensitive keys, presence-based', async () => {
		const { readVar } = await import('./vars');
		expect(readVar({ Qty: 5 }, 'qty')).toBe(5);
		expect(readVar({ qty: 5 }, 'qty')).toBe(5);
		// Presence-based: a boolean is returned (the expansion reports the
		// typed error), not filtered into "unknown variable".
		expect(readVar({ hedged: true }, 'hedged')).toBe(true);
		expect(readVar(undefined, 'qty')).toBeUndefined();
	});

	it('merges with later maps winning, case-insensitively', async () => {
		const { mergeVars } = await import('./vars');
		const merged = mergeVars({ qty: 10, other: 1 }, { Qty: 5 });
		// The local "Qty" shadows the global "qty" — one entry, local value,
		// matching what readVar-based resolution will actually use.
		expect(Object.entries(merged)).toEqual([
			['Qty', 5],
			['other', 1],
		]);
	});
});
