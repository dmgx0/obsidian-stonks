import {
	App,
	MarkdownPostProcessor,
	MarkdownPostProcessorContext,
	MarkdownView,
	editorInfoField,
} from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { ExprError, Field, parseExpression, ParsedExpression } from './eval';
import { QuoteCache } from './cache';
import { isFxLike } from './currency';
import { formatCurrency, formatNumber, formatPercent } from './format';
import { DisplayModifiers, parseModifiers, splitModifiers } from './modifiers';
import { VarLookup, expandVariables } from './vars';
import { ErrorReason, Quote, QuoteResult, StonksSettings } from './types';

/** Provides the `@name` variable lookup for a given note path (frontmatter
 *  properties; wired up in main.ts). Defaults to "no variables defined". */
export type VarsGetter = (sourcePath?: string) => VarLookup;

/** Treat |day move| below this as flat (guards float noise, e.g. a cost basis
 *  cancelling out of the re-evaluated expression). */
const MOVE_EPS = 1e-9;

export type SettingsGetter = () => StonksSettings;

const STATE_CLASSES = [
	'stonks-loading',
	'stonks-error',
	'stonks-up',
	'stonks-down',
	'stonks-warn',
	'stonks-stale',
];

/**
 * Returns the expression body if `raw` starts with the trigger prefix, else
 * null. Because the prefix is `$:` (not bare `$`), ordinary code like `$HOME`
 * is never matched; and `$=` (Dataview) does not start with `$:`, so the two
 * never fight over the same span.
 */
export function matchPrefix(raw: string, prefix: string): string | null {
	const s = raw.trimStart();
	if (!s.startsWith(prefix)) {
		return null;
	}
	const body = s.slice(prefix.length).trim();
	return body.length > 0 ? body : null;
}

/**
 * Widen [from, to] outward over any run of backtick delimiters on each side, so
 * multi-backtick inline code (e.g. `` ``$: AAPL`` ``) is replaced whole rather
 * than leaving stray backticks. `charAt(i)` returns the single char at index i
 * (or '' out of range). Pure + exported for tests.
 */
export function expandToBackticks(
	charAt: (i: number) => string,
	length: number,
	from: number,
	to: number,
): [number, number] {
	let start = from;
	while (start > 0 && charAt(start - 1) === '`') {
		start--;
	}
	let end = to;
	while (end < length && charAt(end) === '`') {
		end++;
	}
	return [start, end];
}

/** True if any selection range touches [start, end], edges included. A replace
 *  widget can't hold the caret *inside* its range — a click lands the caret on
 *  the boundary — so an edge-inclusive test is what reveals the source on click,
 *  the way other inline-code plugins behave. Pure + exported for tests. */
export function rangeTouchedBySelection(
	ranges: ReadonlyArray<{ from: number; to: number }>,
	start: number,
	end: number,
): boolean {
	return ranges.some((r) => r.from <= end && r.to >= start);
}

// Hoisted: toLocaleTimeString would build a fresh Intl.DateTimeFormat on
// every paint of every span — one shared formatter is enough.
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
	timeStyle: 'medium',
});

function tooltipFor(q: Quote, decimals: number): string {
	return `${q.ticker}  ${formatNumber(q.price, decimals)} ${q.currency}  (${formatPercent(
		q.changePct,
		2,
	)})  ·  updated ${TIME_FORMAT.format(q.time)}`;
}

/** Pick a quote's value for a referenced field (bare ticker = price). */
function fieldValue(q: Quote, field: Field): number {
	switch (field) {
		case 'change':
			return q.change;
		case 'pct':
			return q.changePct;
		case 'prev':
			return q.previousClose;
		default:
			return q.price;
	}
}

/** The same field as it stood at yesterday's close — prices collapse to the
 *  previous close and day deltas to zero. Evaluating an expression with this
 *  resolver yields its "yesterday" value; the diff against today is the
 *  expression's own day move (used for colouring). */
function atPreviousClose(q: Quote, field: Field): number {
	switch (field) {
		case 'change':
		case 'pct':
			return 0;
		default:
			return q.previousClose;
	}
}

/** Format a single field reference by its natural type. Modifiers may force a
 *  sign or compact notation on top; percent ignores both currency and compact. */
function formatField(
	value: number,
	field: Field,
	currency: string,
	decimals: number,
	mods: DisplayModifiers,
): string {
	switch (field) {
		case 'pct':
			return formatPercent(value, decimals, { signed: true });
		case 'change':
			return formatCurrency(value, currency, decimals, {
				signed: true,
				compact: mods.compact,
			});
		default:
			return formatCurrency(value, currency, decimals, {
				signed: mods.signed,
				compact: mods.compact,
			});
	}
}

/**
 * Owns the resolve-and-paint lifecycle for every inline span, across both the
 * Reading-view post-processor and the Live-Preview widget. Tracks active spans
 * so a manual / background refresh can repaint them in place.
 */
export class InlineRenderer {
	private active = new Map<
		HTMLElement,
		{ body: string; path?: string; gen: number }
	>();
	// Monotonic resolve generation. The stale guard compares this, not the
	// body text: the same body can paint differently after a frontmatter
	// @variable edit, so "body unchanged" is not "result still current".
	private gen = 0;

	constructor(
		private getSettings: SettingsGetter,
		private cache: QuoteCache,
		private getVars: VarsGetter = () => () => undefined,
	) {}

	fill(el: HTMLElement, body: string, sourcePath?: string): void {
		this.active.set(el, { body, path: sourcePath, gen: ++this.gen });
		void this.resolve(el, body, sourcePath);
	}

	forget(el: HTMLElement): void {
		this.active.delete(el);
	}

	clear(): void {
		this.active.clear();
	}

	rerenderAll(): void {
		this.rerenderWhere(() => true);
	}

	/** Re-resolve the active spans selected by `pred` (stamping a fresh
	 *  generation so any older in-flight resolve of the same span is stale). */
	rerenderWhere(
		pred: (entry: { body: string; path?: string }) => boolean,
	): void {
		for (const [el, entry] of [...this.active]) {
			if (!el.isConnected) {
				this.active.delete(el);
				continue;
			}
			if (!pred(entry)) {
				continue;
			}
			entry.gen = ++this.gen;
			void this.resolve(el, entry.body, entry.path);
		}
	}

	private reset(el: HTMLElement): void {
		el.empty();
		el.removeClasses(STATE_CLASSES);
		el.removeAttribute('aria-label');
		el.addClass('stonks-inline');
	}

	private async resolve(
		el: HTMLElement,
		body: string,
		sourcePath?: string,
	): Promise<void> {
		const settings = this.getSettings();
		const gen = this.active.get(el)?.gen;

		let parsed: ParsedExpression;
		let mods: DisplayModifiers;
		try {
			// Peel the display-modifier section off first (so the grammar never
			// sees the pipe), then expand @variables from the note's properties.
			const split = splitModifiers(body);
			const expr = expandVariables(split.expr, this.getVars(sourcePath));
			parsed = parseExpression(expr);
			mods = parseModifiers(split.mods);
		} catch {
			this.renderError(el, `Stonks: can't parse "${body}"`);
			return;
		}

		// Instant first paint if everything is already cached and OK.
		const peeked = this.peekAll(parsed.tickers);
		if (peeked) {
			this.paint(el, parsed, mods, peeked, settings, body);
		} else {
			this.reset(el);
			el.addClass('stonks-loading');
			el.setText('…');
			el.setAttr('aria-label', `Loading ${body}…`);
		}

		try {
			const results = await this.cache.get(parsed.tickers);
			if (this.active.get(el)?.gen !== gen) {
				return; // span recycled or re-resolved meanwhile — we're stale
			}
			this.paint(el, parsed, mods, results, settings, body);
		} catch {
			this.renderError(el, `Stonks: can't evaluate "${body}"`);
		}
	}

	private peekAll(tickers: string[]): Map<string, QuoteResult> | null {
		const m = new Map<string, QuoteResult>();
		for (const t of tickers) {
			const r = this.cache.peek(t);
			if (!r || !r.ok) {
				return null;
			}
			m.set(t, r);
		}
		return m;
	}

	private paint(
		el: HTMLElement,
		parsed: ParsedExpression,
		mods: DisplayModifiers,
		results: Map<string, QuoteResult>,
		settings: StonksSettings,
		body: string,
	): void {
		// Partition referenced tickers into resolved quotes and failures.
		const quotes = new Map<string, Quote>();
		const failed: Array<{ ticker: string; reason: ErrorReason }> = [];
		for (const t of parsed.tickers) {
			const r = results.get(t);
			if (!r) {
				failed.push({ ticker: t, reason: 'network' });
			} else if (r.ok) {
				quotes.set(t, r.quote);
			} else {
				failed.push({ ticker: t, reason: r.reason });
			}
		}
		if (failed.length > 0) {
			this.renderFetchError(el, failed);
			return;
		}

		const resolve = (field: (q: Quote, f: Field) => number) => {
			return (sym: string, f: Field): number => {
				const q = quotes.get(sym);
				if (!q) {
					throw new ExprError(`missing ${sym}`);
				}
				return field(q, f);
			};
		};

		let result: number;
		try {
			result = parsed.evaluate(resolve(fieldValue));
		} catch {
			this.renderError(el, `Stonks: can't evaluate "${body}"`);
			return;
		}

		this.reset(el);
		const decimals = mods.decimals ?? settings.decimals;

		// Default colouring is by the day move; `sign` recolours by the value's
		// own sign (gains/losses), `plain` turns colour off. Pure rates (FX
		// pairs) have no "up is good" direction, so they stay neutral by default.
		const rateOnly = parsed.tickers.every((t) => isFxLike(t));
		const applyColour = (): void => {
			if (mods.color === 'plain') {
				return;
			}
			let basis = 0;
			if (mods.color === 'sign') {
				basis = result;
			} else if (!rateOnly) {
				// The expression's own day move: re-evaluate at yesterday's
				// closes (price → previousClose, day deltas → 0) and diff.
				// Exact for any shape — a scaled position moves with its
				// ticker, a total with the weighted whole, division inverts
				// correctly, additive constants (a cost basis) cancel out.
				// Computed only on this branch (plain/sign/FX never need it).
				try {
					basis = result - parsed.evaluate(resolve(atPreviousClose));
				} catch {
					basis = 0;
				}
				// A day-delta field in a denominator divides by zero at the
				// previous close (change/pct were 0 yesterday by definition):
				// ±Infinity is "no meaningful move", not a direction.
				if (!Number.isFinite(basis)) {
					basis = 0;
				}
			}
			if (basis > MOVE_EPS) {
				el.addClass('stonks-up');
			} else if (basis < -MOVE_EPS) {
				el.addClass('stonks-down');
			}
		};

		// Single ticker reference: format by its field, keep the quote tooltip.
		if (parsed.single) {
			const { sym, field } = parsed.single;
			const q = quotes.get(sym);
			const currency = mods.currency ?? q?.currency ?? '';
			el.setText(formatField(result, field, currency, decimals, mods));
			applyColour();
			if (q) {
				el.setAttr('aria-label', tooltipFor(q, decimals));
			}
			return;
		}

		// Infer the display currency from the non-FX tickers involved. An
		// explicit currency modifier wins — it is the user asserting "I already
		// converted this" (e.g. `AAPL * USDGBP=X | gbp`), so it also lifts the
		// mixed-currency flag.
		const currencies = new Set<string>();
		for (const t of parsed.tickers) {
			if (isFxLike(t)) {
				continue;
			}
			const c = quotes.get(t)?.currency;
			if (c) {
				currencies.add(c);
			}
		}

		if (mods.currency === undefined && currencies.size > 1) {
			// Mixing currencies in one sum is almost always a mistake — show the
			// number but flag it (uncoloured) rather than implying a bogus total.
			el.setText(formatNumber(result, decimals));
			el.addClass('stonks-warn');
			const list = [...currencies];
			el.setAttr(
				'aria-label',
				`Mixes ${list.join(', ')} — result currency is ambiguous. Convert with an FX pair, e.g. ${list[0]}${list[1]}=X, and label it with | ${(list[1] ?? '').toLowerCase()}.`,
			);
			return;
		}

		const label = mods.currency ?? [...currencies][0] ?? '';
		const text = formatCurrency(result, label, decimals, {
			signed: mods.signed,
			compact: mods.compact,
		});
		el.setText(text);
		applyColour();
		el.setAttr('aria-label', `${body} = ${text}`);
	}

	private renderFetchError(
		el: HTMLElement,
		failed: Array<{ ticker: string; reason: ErrorReason }>,
	): void {
		this.reset(el);
		el.setText('—');
		const unknown = failed.filter((f) => f.reason === 'notfound');
		if (unknown.length > 0) {
			el.addClass('stonks-error');
			el.setAttr(
				'aria-label',
				`Unknown symbol: ${unknown.map((f) => f.ticker).join(', ')}`,
			);
		} else if (failed.some((f) => f.reason === 'ratelimited')) {
			el.addClass('stonks-stale');
			el.setAttr('aria-label', 'Rate-limited by Yahoo Finance — will retry');
		} else {
			el.addClass('stonks-stale');
			el.setAttr('aria-label', 'Offline or network error — will retry');
		}
	}

	private renderError(el: HTMLElement, title: string): void {
		this.reset(el);
		el.addClass('stonks-error');
		el.setText('—');
		el.setAttr('aria-label', title);
	}
}

/** Reading-view: swap matching inline <code> for a resolved span. */
export function buildReadingProcessor(
	renderer: InlineRenderer,
	getSettings: SettingsGetter,
): MarkdownPostProcessor {
	return (el: HTMLElement, ctx?: MarkdownPostProcessorContext) => {
		const codes = Array.from(el.querySelectorAll('code'));
		for (const code of codes) {
			// Skip fenced code blocks (those live inside <pre>).
			if (code.closest('pre')) {
				continue;
			}
			const body = matchPrefix(code.textContent ?? '', getSettings().prefix);
			if (body === null) {
				continue;
			}
			const span = createSpan({ cls: 'stonks-inline' });
			code.replaceWith(span);
			renderer.fill(span, body, ctx?.sourcePath);
		}
	};
}

// Effect to force a decoration rebuild (e.g. after the prefix setting changes).
const stonksRefresh = StateEffect.define<void>();

class QuoteWidget extends WidgetType {
	constructor(
		private renderer: InlineRenderer,
		private body: string,
		private sourcePath?: string,
	) {
		super();
	}

	eq(other: QuoteWidget): boolean {
		return (
			other.body === this.body &&
			other.sourcePath === this.sourcePath &&
			other.renderer === this.renderer
		);
	}

	toDOM(): HTMLElement {
		const span = createSpan({ cls: 'stonks-inline' });
		this.renderer.fill(span, this.body, this.sourcePath);
		return span;
	}

	destroy(dom: HTMLElement): void {
		this.renderer.forget(dom);
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function buildDecorations(
	view: EditorView,
	getSettings: SettingsGetter,
	renderer: InlineRenderer,
): DecorationSet {
	const prefix = getSettings().prefix;
	const builder = new RangeSetBuilder<Decoration>();
	const selection = view.state.selection;
	// The note this editor is bound to — used to resolve @variables from its
	// properties. editorInfoField is Obsidian's own CM6 state field.
	const sourcePath = view.state.field(editorInfoField, false)?.file?.path;

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				// Obsidian tags inline-code content as `inline-code`; the standard
				// lezer markdown parser calls it `InlineCode`. Accept either so a
				// parser/version change degrades gracefully — reading view keys off
				// <code> DOM elements, so it keeps working regardless.
				const nodeName = node.type.name;
				if (
					!nodeName.includes('inline-code') &&
					nodeName !== 'InlineCode'
				) {
					return;
				}
				const text = view.state.doc.sliceString(node.from, node.to);
				const body = matchPrefix(text, prefix);
				if (body === null) {
					return;
				}
				// Cover the surrounding backtick delimiters (any count), so single-
				// and multi-backtick inline code both replace cleanly.
				const doc = view.state.doc;
				const [start, end] = expandToBackticks(
					(i) => doc.sliceString(i, i + 1),
					doc.length,
					node.from,
					node.to,
				);
				// Reveal the raw source when the caret touches the widget so it's
				// as editable as any other inline code (a click lands the caret on
				// the boundary, hence the edge-inclusive test on the full range).
				if (rangeTouchedBySelection(selection.ranges, start, end)) {
					return;
				}
				builder.add(
					start,
					end,
					Decoration.replace({
						widget: new QuoteWidget(renderer, body, sourcePath),
					}),
				);
			},
		});
	}

	return builder.finish();
}

/** Live-Preview: replace matching inline code with a resolved widget. */
export function buildEditorExtension(
	renderer: InlineRenderer,
	getSettings: SettingsGetter,
) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, getSettings, renderer);
			}

			update(u: ViewUpdate): void {
				if (
					u.docChanged ||
					u.viewportChanged ||
					u.selectionSet ||
					u.transactions.some((tr) =>
						tr.effects.some((e) => e.is(stonksRefresh)),
					)
				) {
					this.decorations = buildDecorations(
						u.view,
						getSettings,
						renderer,
					);
				}
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

/** Best-effort: rebuild Live-Preview decorations in all open editors (used
 *  after the prefix changes, where existing widgets are stale). */
export function refreshEditors(app: App): void {
	app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) {
			return;
		}
		// editor.cm is the CM6 EditorView (not in the public types).
		const cm = (view.editor as unknown as { cm?: EditorView }).cm;
		try {
			cm?.dispatch({ effects: stonksRefresh.of(undefined) });
		} catch {
			// Ignore editors that can't take the effect.
		}
	});
}
