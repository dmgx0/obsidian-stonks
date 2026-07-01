// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
	InlineRenderer,
	expandToBackticks,
	rangeTouchedBySelection,
} from '../src/inline';
import { QuoteCache } from '../src/cache';
import { DEFAULT_SETTINGS, QuoteResult } from '../src/types';

function ok(
	ticker: string,
	price: number,
	prev: number,
	currency = 'USD',
): QuoteResult {
	const change = price - prev;
	return {
		ok: true,
		quote: {
			ticker,
			price,
			currency,
			previousClose: prev,
			change,
			changePct: prev !== 0 ? (change / prev) * 100 : 0,
			time: 0,
		},
	};
}

// Fake cache: peek always misses (so the first paint is the loading state),
// get() resolves the canned results.
function makeCache(results: Record<string, QuoteResult>): QuoteCache {
	return {
		peek: () => undefined,
		get: async (tickers: string[]) => {
			const m = new Map<string, QuoteResult>();
			for (const t of tickers) {
				const r = results[t];
				if (r) {
					m.set(t, r);
				}
			}
			return m;
		},
		setTtl: () => {},
		refreshAll: async () => {},
		lastUpdated: () => null,
	} as unknown as QuoteCache;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function render(body: string, results: Record<string, QuoteResult>) {
	const el = document.createElement('span');
	const renderer = new InlineRenderer(() => DEFAULT_SETTINGS, makeCache(results));
	renderer.fill(el, body);
	return el;
}

describe('InlineRenderer', () => {
	it('shows a loading state before the quote resolves', () => {
		const el = render('AAPL', { AAPL: ok('AAPL', 100, 100) });
		expect(el.classList.contains('stonks-loading')).toBe(true);
		expect(el.textContent).toBe('…');
		// The "…" glyph is meaningless to a screen reader; the label carries it.
		expect(el.getAttribute('aria-label')).toContain('AAPL');
	});

	it('renders a single ticker with its value and a down marker', async () => {
		const el = render('AAPL', { AAPL: ok('AAPL', 275.15, 293.17) });
		await flush();
		expect(el.textContent).toContain('275.15');
		expect(el.classList.contains('stonks-down')).toBe(true);
		expect(el.classList.contains('stonks-loading')).toBe(false);
		expect(el.getAttribute('aria-label')).toContain('AAPL');
	});

	it('marks a gainer as up', async () => {
		const el = render('MSFT', { MSFT: ok('MSFT', 210, 200) });
		await flush();
		expect(el.classList.contains('stonks-up')).toBe(true);
	});

	it('computes a same-currency expression and shows that currency', async () => {
		const el = render('AAPL + MSFT', {
			AAPL: ok('AAPL', 100, 100),
			MSFT: ok('MSFT', 200, 200),
		});
		await flush();
		expect(el.textContent).toContain('300.00');
		expect(el.classList.contains('stonks-warn')).toBe(false);
		// Computed result carries the source expression for screen readers.
		expect(el.getAttribute('aria-label')).toContain('AAPL + MSFT');
	});

	it('flags a mixed-currency expression', async () => {
		const el = render('AAPL + LLOY.L', {
			AAPL: ok('AAPL', 100, 100, 'USD'),
			'LLOY.L': ok('LLOY.L', 50, 50, 'GBP'),
		});
		await flush();
		expect(el.textContent).toContain('150.00');
		expect(el.classList.contains('stonks-warn')).toBe(true);
		const title = el.getAttribute('aria-label') ?? '';
		expect(title).toContain('Mixes');
		expect(title).toContain('USD');
		expect(title).toContain('GBP');
	});

	it('does not colour an FX pair by day move', async () => {
		const el = render('EURUSD=X', { 'EURUSD=X': ok('EURUSD=X', 1.08, 1.07) });
		await flush();
		expect(el.textContent).toContain('1.08');
		expect(el.classList.contains('stonks-up')).toBe(false);
		expect(el.classList.contains('stonks-down')).toBe(false);
	});

	it('shows a red error for an unknown symbol', async () => {
		const el = render('NOPE', { NOPE: { ok: false, reason: 'notfound' } });
		await flush();
		expect(el.textContent).toBe('—');
		expect(el.classList.contains('stonks-error')).toBe(true);
		expect(el.getAttribute('aria-label')).toContain('Unknown symbol');
	});

	it('shows a muted, retrying state when rate-limited', async () => {
		const el = render('AAPL', { AAPL: { ok: false, reason: 'ratelimited' } });
		await flush();
		expect(el.textContent).toBe('—');
		expect(el.classList.contains('stonks-stale')).toBe(true);
		expect(el.getAttribute('aria-label')).toContain('Rate-limited');
	});

	it('shows an offline state on a network error', async () => {
		const el = render('AAPL', { AAPL: { ok: false, reason: 'network' } });
		await flush();
		expect(el.classList.contains('stonks-stale')).toBe(true);
		expect(el.getAttribute('aria-label')).toContain('Offline');
	});

	it('renders a parse error inline rather than throwing', async () => {
		const el = render('AAPL *', { AAPL: ok('AAPL', 100, 100) });
		await flush();
		expect(el.textContent).toBe('—');
		expect(el.classList.contains('stonks-error')).toBe(true);
	});

	it('renders a .change field as signed currency, coloured up', async () => {
		const el = render('AAPL.change', { AAPL: ok('AAPL', 110, 100) });
		await flush();
		expect(el.textContent).toContain('10');
		expect(el.textContent?.startsWith('+')).toBe(true);
		expect(el.classList.contains('stonks-up')).toBe(true);
	});

	it('renders a .pct field as a signed percent, coloured down', async () => {
		const el = render('AAPL.pct', { AAPL: ok('AAPL', 90, 100) });
		await flush();
		expect(el.textContent).toContain('%');
		expect(el.textContent).toContain('10');
		expect(el.classList.contains('stonks-down')).toBe(true);
	});
});

describe('InlineRenderer — day-move colouring of computed values', () => {
	it('colours a scaled position by its ticker\'s move', async () => {
		const el = render('AAPL * 25', { AAPL: ok('AAPL', 90, 100) });
		await flush();
		expect(el.textContent).toContain('2,250.00'); // value itself is positive…
		expect(el.classList.contains('stonks-down')).toBe(true); // …but the day move is down
	});

	it('colours a portfolio total by its weighted day move', async () => {
		// AAPL down 10 × 1 share, MSFT up 1 × 100 shares → net up.
		const el = render('AAPL + MSFT * 100', {
			AAPL: ok('AAPL', 90, 100),
			MSFT: ok('MSFT', 201, 200),
		});
		await flush();
		expect(el.classList.contains('stonks-up')).toBe(true);
	});

	it('cancels additive constants (a cost basis) out of the move', async () => {
		// Result is negative (below basis) but today's move is up: move wins.
		const el = render('AAPL * 25 - 10000', { AAPL: ok('AAPL', 110, 100) });
		await flush();
		expect(el.textContent).toContain('-');
		expect(el.classList.contains('stonks-up')).toBe(true);
	});

	it('inverts the colour for inverse exposure (division by a ticker)', async () => {
		// AAPL up → 100/AAPL down.
		const el = render('100 / AAPL', { AAPL: ok('AAPL', 110, 100) });
		await flush();
		expect(el.classList.contains('stonks-down')).toBe(true);
	});

	it('keeps a flat expression neutral', async () => {
		const el = render('AAPL * 25', { AAPL: ok('AAPL', 100, 100) });
		await flush();
		expect(el.classList.contains('stonks-up')).toBe(false);
		expect(el.classList.contains('stonks-down')).toBe(false);
	});
});

describe('InlineRenderer — display modifiers', () => {
	it('sign: colours by the value\'s own sign instead of the move', async () => {
		// Day move is up, but the P&L value is negative → red under `sign`.
		const el = render('AAPL * 25 - 10000 | sign', {
			AAPL: ok('AAPL', 110, 100),
		});
		await flush();
		expect(el.classList.contains('stonks-down')).toBe(true);
		expect(el.classList.contains('stonks-up')).toBe(false);
	});

	it('plain: turns colouring off entirely', async () => {
		const el = render('AAPL * 25 | plain', { AAPL: ok('AAPL', 110, 100) });
		await flush();
		expect(el.classList.contains('stonks-up')).toBe(false);
		expect(el.classList.contains('stonks-down')).toBe(false);
	});

	it('digit: overrides the decimal places for this expression', async () => {
		const el = render('AAPL + MSFT | 0', {
			AAPL: ok('AAPL', 100, 100),
			MSFT: ok('MSFT', 200, 200),
		});
		await flush();
		expect(el.textContent).toContain('300');
		expect(el.textContent).not.toContain('.00');
	});

	it('currency label: asserts the result currency and lifts the mixed flag', async () => {
		const el = render('AAPL + LLOY.L | gbp', {
			AAPL: ok('AAPL', 100, 100, 'USD'),
			'LLOY.L': ok('LLOY.L', 50, 50, 'GBP'),
		});
		await flush();
		expect(el.classList.contains('stonks-warn')).toBe(false);
		expect(el.textContent).toContain('£');
	});

	it('compact: renders large values in 1.2M style', async () => {
		const el = render('BTC-USD * 25 | compact', {
			'BTC-USD': ok('BTC-USD', 60000, 60000),
		});
		await flush();
		expect(el.textContent).toContain('1.5M');
	});

	it('+ : always shows the sign on a gain', async () => {
		const el = render('AAPL * 25 - 1000 | +', { AAPL: ok('AAPL', 100, 90) });
		await flush();
		expect(el.textContent?.startsWith('+')).toBe(true);
	});

	it('applies to a bare single ticker too', async () => {
		const el = render('AAPL | 0 plain', { AAPL: ok('AAPL', 275.15, 293) });
		await flush();
		expect(el.textContent).toContain('275');
		expect(el.textContent).not.toContain('275.15');
		expect(el.classList.contains('stonks-down')).toBe(false);
	});

	it('accepts the escaped pipe form used inside markdown tables', async () => {
		const el = render('AAPL + MSFT \\| 0', {
			AAPL: ok('AAPL', 100, 100),
			MSFT: ok('MSFT', 200, 200),
		});
		await flush();
		expect(el.textContent).toContain('300');
		expect(el.textContent).not.toContain('.00');
	});

	it('rejects an unknown modifier as a parse error', async () => {
		const el = render('AAPL | wat', { AAPL: ok('AAPL', 100, 100) });
		await flush();
		expect(el.textContent).toBe('—');
		expect(el.classList.contains('stonks-error')).toBe(true);
	});
});

describe('InlineRenderer — @variables from properties', () => {
	function renderWithVars(
		body: string,
		results: Record<string, QuoteResult>,
		vars: Record<string, string | number>,
	) {
		const el = document.createElement('span');
		const renderer = new InlineRenderer(
			() => DEFAULT_SETTINGS,
			makeCache(results),
			() => (name) => vars[name],
		);
		renderer.fill(el, body, 'note.md');
		return el;
	}

	it('resolves a number variable', async () => {
		const el = renderWithVars(
			'AAPL * @qty',
			{ AAPL: ok('AAPL', 100, 100) },
			{ qty: 25 },
		);
		await flush();
		expect(el.textContent).toContain('2,500.00');
	});

	it('expands a string variable as an alias, modifiers at the usage site', async () => {
		const el = renderWithVars(
			'@portfolio - 250 | sign',
			{
				AAPL: ok('AAPL', 100, 100),
				MSFT: ok('MSFT', 200, 200),
			},
			{ portfolio: 'AAPL * 2 + MSFT' },
		);
		await flush();
		expect(el.textContent).toContain('150.00');
		expect(el.classList.contains('stonks-up')).toBe(true); // sign of +150
	});

	it('shows a parse error for an unknown variable', async () => {
		const el = renderWithVars('@nope', {}, {});
		await flush();
		expect(el.textContent).toBe('—');
		expect(el.classList.contains('stonks-error')).toBe(true);
	});

	it('a stale in-flight resolve never overwrites a newer one', async () => {
		// First resolve hangs on a deferred fetch; the variable then changes and
		// a re-render paints the new value. When the old fetch finally lands,
		// its generation is stale — it must NOT repaint the old expansion.
		const vars: Record<string, string> = { p: 'AAPL' };
		let releaseFirst!: () => void;
		let call = 0;
		const cache = {
			peek: () => undefined,
			get: (tickers: string[]) => {
				call++;
				const m = new Map<string, QuoteResult>();
				for (const t of tickers) {
					m.set(t, t === 'AAPL' ? ok('AAPL', 111, 111) : ok('MSFT', 222, 222));
				}
				if (call === 1) {
					return new Promise<Map<string, QuoteResult>>((res) => {
						releaseFirst = () => res(m);
					});
				}
				return Promise.resolve(m);
			},
		} as unknown as QuoteCache;

		const renderer = new InlineRenderer(
			() => DEFAULT_SETTINGS,
			cache,
			() => (name) => vars[name],
		);
		const el = document.createElement('span');
		document.body.appendChild(el); // rerender skips disconnected spans
		renderer.fill(el, '@p', 'note.md'); // resolve #1: AAPL, hangs
		vars.p = 'MSFT'; // the property changes
		renderer.rerenderAll(); // resolve #2: MSFT, resolves immediately
		await flush();
		expect(el.textContent).toContain('222');
		releaseFirst(); // the stale AAPL fetch finally lands
		await flush();
		expect(el.textContent).toContain('222'); // and must not win
	});
});

describe('InlineRenderer — day-move edge cases', () => {
	it('treats a non-finite day move (delta in a denominator) as neutral', async () => {
		// Yesterday's pct is 0 by definition → 100/0 = Infinity at prev close.
		const el = render('100 / AAPL.pct', { AAPL: ok('AAPL', 110, 100) });
		await flush();
		expect(el.classList.contains('stonks-up')).toBe(false);
		expect(el.classList.contains('stonks-down')).toBe(false);
	});
});

describe('InlineRenderer — targeted re-render', () => {
	it('rerenderWhere only re-resolves matching spans', async () => {
		let gets = 0;
		const cache = {
			peek: () => undefined,
			get: (tickers: string[]) => {
				gets++;
				const m = new Map<string, QuoteResult>();
				for (const t of tickers) {
					m.set(t, ok(t, 100, 100));
				}
				return Promise.resolve(m);
			},
		} as unknown as QuoteCache;
		const renderer = new InlineRenderer(
			() => DEFAULT_SETTINGS,
			cache,
			() => (name) => (name === 'q' ? 2 : undefined),
		);
		const plain = document.createElement('span');
		const withVar = document.createElement('span');
		document.body.append(plain, withVar); // rerender skips disconnected spans
		renderer.fill(plain, 'AAPL', 'a.md');
		renderer.fill(withVar, 'AAPL * @q', 'b.md');
		await flush();
		const before = gets;
		renderer.rerenderWhere(
			(e) => e.body.includes('@') && e.path === 'b.md',
		);
		await flush();
		expect(gets).toBe(before + 1); // only the @-span in b.md re-resolved
	});
});

describe('expandToBackticks', () => {
	const at = (text: string) => (i: number) => text[i] ?? '';

	it('covers a single backtick pair', () => {
		const text = '`$: AAPL`';
		expect(expandToBackticks(at(text), text.length, 1, 8)).toEqual([0, 9]);
	});

	it('covers a multi-backtick pair', () => {
		const text = '``$: AAPL``';
		expect(expandToBackticks(at(text), text.length, 2, 9)).toEqual([0, 11]);
	});

	it('leaves the range unchanged when there are no backticks', () => {
		const text = 'xx$: AAPLxx';
		expect(expandToBackticks(at(text), text.length, 2, 9)).toEqual([2, 9]);
	});
});

describe('rangeTouchedBySelection', () => {
	const caret = (pos: number) => [{ from: pos, to: pos }];

	it('reveals when the caret sits on either edge', () => {
		expect(rangeTouchedBySelection(caret(2), 2, 9)).toBe(true); // start
		expect(rangeTouchedBySelection(caret(9), 2, 9)).toBe(true); // end
	});

	it('does not reveal when the caret is just outside', () => {
		expect(rangeTouchedBySelection(caret(1), 2, 9)).toBe(false);
		expect(rangeTouchedBySelection(caret(10), 2, 9)).toBe(false);
	});

	it('reveals when a selection spans the range', () => {
		expect(rangeTouchedBySelection([{ from: 0, to: 20 }], 2, 9)).toBe(true);
	});
});
