// Autocomplete for `$:` spans: tickers you've used, `.fields`, `| modifiers`
// and `@variables`. The context classifier and the suggestion sources are pure
// (unit-tested); the EditorSuggest subclass at the bottom is a thin Obsidian
// shell over them, verified manually like the rest of the editor layer.

import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from 'obsidian';
import { QuoteCache } from './cache';
import { formatCurrency, formatNumber } from './format';
import { SettingsGetter } from './inline';
import { splitModifiers } from './modifiers';
import { mergeVars } from './vars';

export interface Suggestion {
	/** Shown as the row label and inserted on select. */
	insert: string;
	/** Muted hint text (field meaning, cached price, variable value). */
	detail?: string;
}

export type SuggestKind = 'ticker' | 'field' | 'modifier' | 'var';

export interface SuggestContext {
	kind: SuggestKind;
	/** The partial word being completed (replaced on select). */
	query: string;
}

/**
 * Classify what should be suggested given the span text between the trigger
 * prefix and the cursor. Order matters: a pipe puts the whole tail in modifier
 * land, `@` wins over ticker, and a trailing `.partial` on a ticker-ish token
 * means fields.
 */
export function classifySuggest(afterPrefix: string): SuggestContext | null {
	// Defer to splitModifiers for pipe semantics (incl. the `\|` table escape),
	// so the suggester and the renderer can never disagree about what counts
	// as the modifier section.
	const { mods } = splitModifiers(afterPrefix);
	if (mods !== null) {
		const partial = /[A-Za-z0-9+]*$/.exec(mods)?.[0] ?? '';
		return { kind: 'modifier', query: partial };
	}

	const at = /@([A-Za-z0-9_-]*)$/.exec(afterPrefix);
	if (at?.[1] !== undefined) {
		return { kind: 'var', query: at[1] };
	}

	const dotted = /[A-Za-z^][A-Za-z0-9=-]*(?:\.[A-Za-z0-9]+)*\.([A-Za-z]*)$/.exec(
		afterPrefix,
	);
	if (dotted) {
		return { kind: 'field', query: dotted[1]! };
	}

	const word = /[A-Za-z^][A-Za-z0-9.=-]*$/.exec(afterPrefix);
	if (word) {
		return { kind: 'ticker', query: word[0] };
	}

	// Start of an operand (empty span, after an operator / open paren / space):
	// offer the seen tickers.
	if (/^\s*$|[+\-*/%(\s]$/.test(afterPrefix)) {
		return { kind: 'ticker', query: '' };
	}
	return null;
}

const FIELD_INFO: ReadonlyArray<Suggestion> = [
	{ insert: 'change', detail: "today's change, signed" },
	{ insert: 'pct', detail: "today's % change, signed" },
	{ insert: 'prev', detail: 'previous close' },
	{ insert: 'price', detail: 'the price (same as no field)' },
];

const MODIFIER_INFO: ReadonlyArray<Suggestion> = [
	{ insert: 'sign', detail: "colour by the value's own sign (P&L)" },
	{ insert: 'plain', detail: 'no colouring' },
	{ insert: '+', detail: 'always show the sign' },
	{ insert: 'compact', detail: '1.2M-style notation' },
	{ insert: '0', detail: 'decimals for this value (0–8)' },
	{ insert: '2', detail: 'decimals for this value (0–8)' },
	{ insert: 'usd', detail: 'label the result currency' },
	{ insert: 'eur', detail: 'label the result currency' },
	{ insert: 'gbp', detail: 'label the result currency' },
];

export function fieldSuggestions(query: string): Suggestion[] {
	const q = query.toLowerCase();
	return FIELD_INFO.filter((f) => f.insert.startsWith(q));
}

export function modifierSuggestions(query: string): Suggestion[] {
	const q = query.toLowerCase();
	if (/^[0-8]$/.test(q)) {
		return [{ insert: q, detail: 'decimals for this value' }];
	}
	return MODIFIER_INFO.filter((m) => m.insert.startsWith(q));
}

export function tickerSuggestions(
	query: string,
	seen: ReadonlyArray<string>,
	priceOf: (ticker: string) => string | undefined = () => undefined,
): Suggestion[] {
	const q = query.toUpperCase();
	return [...seen]
		.sort()
		.filter((t) => t.startsWith(q) && t !== q)
		.map((t) => ({ insert: t, detail: priceOf(t) }));
}

export function varSuggestions(
	query: string,
	vars: Record<string, unknown>,
): Suggestion[] {
	const q = query.toLowerCase();
	return Object.entries(vars)
		.filter(
			([key, value]) =>
				key.toLowerCase().startsWith(q) &&
				(typeof value === 'number' || typeof value === 'string'),
		)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => ({
			insert: key,
			detail:
				typeof value === 'number'
					? formatNumber(value, value % 1 === 0 ? 0 : 2)
					: String(value).length > 40
						? `${String(value).slice(0, 40)}…`
						: String(value),
		}));
}

/** Frontmatter accessor injected from main.ts (note-local + variables note). */
export type FrontmatterGetter = (
	path?: string,
) => Record<string, unknown> | undefined;

export class StonksSuggest extends EditorSuggest<Suggestion> {
	private kind: SuggestKind = 'ticker';

	constructor(
		app: App,
		private getSettings: SettingsGetter,
		private cache: QuoteCache,
		private frontmatterFor: FrontmatterGetter,
		private getVariablesNote: () => string,
	) {
		super(app);
		this.limit = 20;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line).slice(0, cursor.ch);
		// Inside an open single-backtick span? (Odd number of backticks before
		// the cursor. Multi-backtick spans don't get suggestions — rare, and
		// the parity test can't tell them apart.)
		const ticks = line.match(/`/g)?.length ?? 0;
		if (ticks % 2 === 0) {
			return null;
		}
		const span = line.slice(line.lastIndexOf('`') + 1).trimStart();
		const prefix = this.getSettings().prefix;
		if (!span.startsWith(prefix)) {
			return null;
		}
		const ctx = classifySuggest(span.slice(prefix.length));
		if (!ctx) {
			return null;
		}
		this.kind = ctx.kind;
		return {
			start: { line: cursor.line, ch: cursor.ch - ctx.query.length },
			end: cursor,
			query: ctx.query,
		};
	}

	getSuggestions(context: EditorSuggestContext): Suggestion[] {
		switch (this.kind) {
			case 'field':
				return fieldSuggestions(context.query);
			case 'modifier':
				return modifierSuggestions(context.query);
			case 'var':
				// mergeVars mirrors the renderer's precedence (note-local wins,
				// case-insensitively), so previews show what will resolve.
				return varSuggestions(
					context.query,
					mergeVars(
						this.frontmatterFor(this.getVariablesNote()),
						this.frontmatterFor(context.file?.path),
					),
				);
			default:
				return tickerSuggestions(
					context.query,
					this.cache.tickers(),
					(ticker) => {
						const r = this.cache.peek(ticker);
						return r?.ok
							? formatCurrency(
									r.quote.price,
									r.quote.currency,
									this.getSettings().decimals,
								)
							: undefined;
					},
				);
		}
	}

	renderSuggestion(value: Suggestion, el: HTMLElement): void {
		el.createDiv({ text: value.insert });
		if (value.detail) {
			el.createDiv({ text: value.detail, cls: 'stonks-suggest-detail' });
		}
	}

	selectSuggestion(value: Suggestion): void {
		const ctx = this.context;
		if (!ctx) {
			return;
		}
		ctx.editor.replaceRange(value.insert, ctx.start, ctx.end);
		ctx.editor.setCursor({
			line: ctx.start.line,
			ch: ctx.start.ch + value.insert.length,
		});
		this.close();
	}
}
