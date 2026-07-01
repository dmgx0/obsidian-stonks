import { describe, it, expect } from 'vitest';
import { parseModifiers, splitModifiers } from './modifiers';

describe('splitModifiers', () => {
	it('passes a body without a pipe through untouched', () => {
		expect(splitModifiers('AAPL * 25')).toEqual({
			expr: 'AAPL * 25',
			mods: null,
		});
	});

	it('splits on the first pipe', () => {
		expect(splitModifiers('AAPL * 25 | sign 0')).toEqual({
			expr: 'AAPL * 25 ',
			mods: ' sign 0',
		});
	});

	it('treats the escaped pipe markdown tables need as a plain pipe', () => {
		// Live Preview sees the raw `\|` while Reading view sees `|`;
		// both spellings must behave identically.
		expect(splitModifiers('AAPL * 25 \\| 0')).toEqual({
			expr: 'AAPL * 25 ',
			mods: ' 0',
		});
	});
});

describe('parseModifiers', () => {
	it('returns no modifiers when there was no pipe', () => {
		expect(parseModifiers(null)).toEqual({});
	});

	it('parses colour modes', () => {
		expect(parseModifiers('sign').color).toBe('sign');
		expect(parseModifiers('plain').color).toBe('plain');
	});

	it('lets a later colour mode win', () => {
		expect(parseModifiers('sign plain').color).toBe('plain');
	});

	it('parses decimals in the settings range 0..8', () => {
		expect(parseModifiers('0').decimals).toBe(0);
		expect(parseModifiers('8').decimals).toBe(8);
		expect(() => parseModifiers('9')).toThrow();
	});

	it('parses the sign and compact flags', () => {
		expect(parseModifiers('+').signed).toBe(true);
		expect(parseModifiers('compact').compact).toBe(true);
	});

	it('reads a three-letter word as an uppercased currency label', () => {
		expect(parseModifiers('gbp').currency).toBe('GBP');
		expect(parseModifiers('EUR').currency).toBe('EUR');
	});

	it('combines independent modifiers', () => {
		expect(parseModifiers('sign 0 gbp +')).toEqual({
			color: 'sign',
			decimals: 0,
			currency: 'GBP',
			signed: true,
		});
	});

	it('is case-insensitive for keywords', () => {
		expect(parseModifiers('SIGN Compact').color).toBe('sign');
		expect(parseModifiers('SIGN Compact').compact).toBe(true);
	});

	it('rejects unknown modifiers and an empty section', () => {
		expect(() => parseModifiers('wat')).toThrow();
		expect(() => parseModifiers('')).toThrow();
		expect(() => parseModifiers('   ')).toThrow();
	});
});
