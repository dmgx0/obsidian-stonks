// Per-expression display modifiers: `$: <expr> | <modifiers>`.
//
// The pipe section is peeled off BEFORE the expression parser runs, so the
// arithmetic grammar never changes. Each modifier is one word; unknown words
// are an error (typo safety). Pure — no Obsidian imports.

import { ExprError } from './eval';

export interface DisplayModifiers {
	/** Colour override: by the value's own sign, or no colour at all. Absent =
	 *  the default day-move colouring. */
	color?: 'sign' | 'plain';
	/** Decimal places for this expression (overrides the global setting). */
	decimals?: number;
	/** Always show the sign of the value ("+" on gains). */
	signed?: boolean;
	/** Compact notation (1,200,000 → 1.2M). */
	compact?: boolean;
	/** Display-currency label (uppercased ISO code). A label, not a conversion —
	 *  meant for expressions the user already converted with an FX pair. */
	currency?: string;
}

/**
 * Split an inline body into the expression and the modifier section (after the
 * first `|`). Tolerates the escaped form `\|` that markdown tables require —
 * Live Preview sees the raw backslash while Reading view sees a bare pipe, so
 * both spellings must mean the same thing. `mods: null` = no pipe present.
 */
export function splitModifiers(raw: string): {
	expr: string;
	mods: string | null;
} {
	const normalized = raw.replace(/\\\|/g, '|');
	const i = normalized.indexOf('|');
	if (i === -1) {
		return { expr: normalized, mods: null };
	}
	return { expr: normalized.slice(0, i), mods: normalized.slice(i + 1) };
}

// Restrict currency labels to real ISO 4217 codes, so a three-letter typo
// (`| wat`) errors instead of silently becoming a bogus label. On a runtime
// without supportedValuesOf we fall back to accepting any three-letter word —
// formatCurrency already degrades to "number CODE" for codes Intl rejects.
const KNOWN_CURRENCIES: ReadonlySet<string> | null = (() => {
	const intl = Intl as unknown as {
		supportedValuesOf?: (key: string) => string[];
	};
	try {
		return intl.supportedValuesOf
			? new Set(intl.supportedValuesOf('currency'))
			: null;
	} catch {
		return null;
	}
})();

/** Parse the modifier section. Later words win on conflict; unknown words
 *  throw (surfacing as the standard inline parse error). */
export function parseModifiers(mods: string | null): DisplayModifiers {
	const out: DisplayModifiers = {};
	if (mods === null) {
		return out;
	}
	const words = mods.trim().split(/\s+/).filter((w) => w.length > 0);
	if (words.length === 0) {
		throw new ExprError('Empty modifier section after "|"');
	}
	for (const word of words) {
		const w = word.toLowerCase();
		if (w === 'sign' || w === 'plain') {
			out.color = w;
		} else if (w === '+') {
			out.signed = true;
		} else if (w === 'compact') {
			out.compact = true;
		} else if (/^[0-8]$/.test(w)) {
			out.decimals = Number(w);
		} else if (/^[a-z]{3}$/.test(w)) {
			const code = w.toUpperCase();
			if (KNOWN_CURRENCIES && !KNOWN_CURRENCIES.has(code)) {
				throw new ExprError(`Unknown modifier "${word}"`);
			}
			out.currency = code;
		} else {
			throw new ExprError(`Unknown modifier "${word}"`);
		}
	}
	return out;
}
