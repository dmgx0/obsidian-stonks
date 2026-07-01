// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildReadingProcessor, matchPrefix, InlineRenderer } from '../src/inline';
import { QuoteCache } from '../src/cache';
import { DEFAULT_SETTINGS } from '../src/types';

const noopCache = {
	peek: () => undefined,
	get: async () => new Map(),
	setTtl: () => {},
	refreshAll: async () => {},
	lastUpdated: () => null,
} as unknown as QuoteCache;

function process(html: string): HTMLElement {
	const root = document.createElement('div');
	root.innerHTML = html;
	const renderer = new InlineRenderer(() => DEFAULT_SETTINGS, noopCache);
	buildReadingProcessor(renderer, () => DEFAULT_SETTINGS)(root);
	return root;
}

describe('matchPrefix', () => {
	it('returns the body for a matching prefix', () => {
		expect(matchPrefix('$: AAPL', '$:')).toBe('AAPL');
		expect(matchPrefix('$:AAPL * 2', '$:')).toBe('AAPL * 2');
	});

	it('ignores non-matching or empty bodies', () => {
		expect(matchPrefix('=1+1', '$:')).toBeNull(); // Dataview
		expect(matchPrefix('#: 2+2', '$:')).toBeNull(); // Numerals
		expect(matchPrefix('$HOME', '$:')).toBeNull(); // shell var
		expect(matchPrefix('$:', '$:')).toBeNull(); // empty body
	});
});

describe('buildReadingProcessor', () => {
	it('replaces only the $: inline code, leaving others untouched', () => {
		const root = process(
			'<p>Price <code>$: AAPL</code></p>' +
				'<p>Numerals <code>#: 2+2</code></p>' +
				'<p>Dataview <code>=1+1</code></p>' +
				'<pre><code>$: AAPL</code></pre>',
		);

		// One span materialized.
		expect(root.querySelectorAll('span.stonks-inline').length).toBe(1);
		// The three non-matching codes (incl. the fenced block) remain as <code>.
		expect(root.querySelectorAll('code').length).toBe(3);
		// The code block was not touched.
		expect(root.querySelector('pre code')?.textContent).toBe('$: AAPL');
	});

	it('does nothing when there is no matching code', () => {
		const root = process('<p>plain <code>console.log()</code></p>');
		expect(root.querySelectorAll('span.stonks-inline').length).toBe(0);
		expect(root.querySelectorAll('code').length).toBe(1);
	});
});
