import { describe, it, expect } from 'vitest';
import {
	classifySuggest,
	fieldSuggestions,
	modifierSuggestions,
	tickerSuggestions,
	varSuggestions,
} from './suggest';

describe('classifySuggest', () => {
	it('suggests tickers for a partial word', () => {
		expect(classifySuggest(' AA')).toEqual({ kind: 'ticker', query: 'AA' });
		expect(classifySuggest(' ^GS')).toEqual({ kind: 'ticker', query: '^GS' });
		expect(classifySuggest(' BTC-U')).toEqual({
			kind: 'ticker',
			query: 'BTC-U',
		});
	});

	it('suggests tickers at operand starts (empty, operator, paren)', () => {
		expect(classifySuggest('')?.kind).toBe('ticker');
		expect(classifySuggest(' AAPL * ')).toEqual({
			kind: 'ticker',
			query: '',
		});
		expect(classifySuggest(' (')).toEqual({ kind: 'ticker', query: '' });
	});

	it('suggests fields after a dot on a ticker-ish token', () => {
		expect(classifySuggest(' AAPL.')).toEqual({ kind: 'field', query: '' });
		expect(classifySuggest(' AAPL.ch')).toEqual({
			kind: 'field',
			query: 'ch',
		});
		// The exchange suffix stays part of the token; fields still complete.
		expect(classifySuggest(' VWRA.L.p')).toEqual({
			kind: 'field',
			query: 'p',
		});
	});

	it('suggests modifiers after a pipe (raw or table-escaped)', () => {
		expect(classifySuggest(' AAPL | ')).toEqual({
			kind: 'modifier',
			query: '',
		});
		expect(classifySuggest(' AAPL | si')).toEqual({
			kind: 'modifier',
			query: 'si',
		});
		expect(classifySuggest(' AAPL \\| 0 si')).toEqual({
			kind: 'modifier',
			query: 'si',
		});
	});

	it('suggests variables after @', () => {
		expect(classifySuggest(' AAPL * @')).toEqual({ kind: 'var', query: '' });
		expect(classifySuggest(' @qty_a')).toEqual({
			kind: 'var',
			query: 'qty_a',
		});
	});

	it('returns null after a digit (no completion mid-number)', () => {
		expect(classifySuggest(' AAPL * 25')).toBeNull();
	});
});

describe('suggestion sources', () => {
	it('filters fields by prefix', () => {
		expect(fieldSuggestions('p').map((s) => s.insert)).toEqual([
			'pct',
			'prev',
			'price',
		]);
		expect(fieldSuggestions('').length).toBe(4);
	});

	it('filters modifiers, treating a digit as decimals', () => {
		expect(modifierSuggestions('si')[0]?.insert).toBe('sign');
		expect(modifierSuggestions('7')).toEqual([
			{ insert: '7', detail: 'decimals for this value' },
		]);
	});

	it('filters and sorts seen tickers, excluding an exact match', () => {
		const out = tickerSuggestions('AA', ['MSFT', 'AAPL', 'AA'], () => '1');
		expect(out.map((s) => s.insert)).toEqual(['AAPL']);
		expect(out[0]?.detail).toBe('1');
	});

	it('suggests only number/string variables, with value previews', () => {
		const out = varSuggestions('', {
			qty: 25,
			portfolio: 'AAPL * 2',
			nested: { no: true },
		});
		expect(out.map((s) => s.insert)).toEqual(['portfolio', 'qty']);
		expect(out[1]?.detail).toBe('25');
		expect(out[0]?.detail).toBe('AAPL * 2');
	});

	it('matches variables case-insensitively', () => {
		expect(varSuggestions('QTY', { qty_aapl: 1 }).length).toBe(1);
	});
});

describe('suggestion vocabulary stays in sync with the engine', () => {
	it('every suggested modifier parses', async () => {
		const { parseModifiers } = await import('./modifiers');
		for (const s of modifierSuggestions('')) {
			expect(() => parseModifiers(s.insert), s.insert).not.toThrow();
		}
	});

	it('every suggested field parses as a ticker field', async () => {
		const { parseExpression } = await import('./eval');
		for (const s of fieldSuggestions('')) {
			const parsed = parseExpression(`AAPL.${s.insert}`);
			expect(parsed.single?.field, s.insert).toBe(
				s.insert === 'price' ? 'price' : s.insert,
			);
		}
	});
});
