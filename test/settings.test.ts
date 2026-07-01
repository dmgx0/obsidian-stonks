import { describe, it, expect } from 'vitest';
import { parseNumberSetting, conflictingPlugin } from '../src/settings';

describe('parseNumberSetting', () => {
	it('accepts a valid number', () => {
		expect(parseNumberSetting('60', { min: 0 })).toBe(60);
		expect(parseNumberSetting('0', { min: 0 })).toBe(0);
	});

	it('rejects empty or non-numeric input', () => {
		expect(parseNumberSetting('', { min: 0 })).toBeNull();
		expect(parseNumberSetting('   ', { min: 0 })).toBeNull();
		expect(parseNumberSetting('abc', { min: 0 })).toBeNull();
	});

	it('rejects values below the minimum', () => {
		expect(parseNumberSetting('-1', { min: 0 })).toBeNull();
	});

	it('rejects NaN and Infinity', () => {
		expect(parseNumberSetting('Infinity', { min: 0 })).toBeNull();
		expect(parseNumberSetting('NaN', { min: 0 })).toBeNull();
	});

	it('enforces max and integer for decimals', () => {
		const rule = { min: 0, max: 8, integer: true };
		expect(parseNumberSetting('8', rule)).toBe(8);
		expect(parseNumberSetting('9', rule)).toBeNull();
		expect(parseNumberSetting('2.5', rule)).toBeNull();
	});
});

describe('conflictingPlugin', () => {
	it('passes the default prefix', () => {
		expect(conflictingPlugin('$:')).toBeNull();
	});

	it('flags Dataview and Numerals prefixes', () => {
		expect(conflictingPlugin('=')).toBe('Dataview');
		expect(conflictingPlugin('$=')).toBe('Dataview');
		expect(conflictingPlugin('#:')).toBe('Numerals');
	});

	it('flags a bare prefix that another prefix starts with', () => {
		expect(conflictingPlugin('#')).toBe('Numerals');
	});

	it('treats an empty prefix as non-conflicting', () => {
		expect(conflictingPlugin('')).toBeNull();
	});
});
