// Pure number formatting — no Obsidian imports, so it's unit-testable. The
// renderer and (later) field access both go through here, so every value type
// formats consistently. `locale` defaults to the user's system locale; tests
// pass an explicit one for determinism.

function sign(value: number): string {
	return value > 0 ? '+' : '';
}

/** Plain grouped number with fixed decimals (e.g. 1,234.50). */
export function formatNumber(
	value: number,
	decimals: number,
	locale?: string,
): string {
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	}).format(value);
}

/** Currency amount (e.g. $275.15). `signed` prefixes gains with '+' (financial
 *  convention); negatives already carry '-'. `compact` switches to 1.2M-style
 *  notation (which then owns the digit count). Falls back to "number CODE" for
 *  an unknown/malformed ISO code, and to a plain number for no currency. */
export function formatCurrency(
	value: number,
	currency: string,
	decimals: number,
	opts: { signed?: boolean; compact?: boolean; locale?: string } = {},
): string {
	const prefix = opts.signed ? sign(value) : '';
	const digits: Intl.NumberFormatOptions = opts.compact
		? { notation: 'compact', maximumFractionDigits: 1 }
		: { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
	const bare = opts.compact
		? formatCompact(value, opts.locale)
		: formatNumber(value, decimals, opts.locale);
	if (currency) {
		try {
			return (
				prefix +
				new Intl.NumberFormat(opts.locale, {
					style: 'currency',
					currency,
					...digits,
				}).format(value)
			);
		} catch {
			// Unknown/malformed ISO code: fall through to number + code.
		}
		return `${prefix}${bare} ${currency}`;
	}
	return prefix + bare;
}

/** Percentage where `value` is already in percent units (6.15 → "6.15%").
 *  Signs by default ("+0.26%" / "-6.15%"); pass `signed: false` to drop the +. */
export function formatPercent(
	value: number,
	decimals: number,
	opts: { signed?: boolean; locale?: string } = {},
): string {
	const prefix = opts.signed === false ? '' : sign(value);
	return `${prefix}${formatNumber(value, decimals, opts.locale)}%`;
}

/** Compact large number (e.g. 1,200,000 → "1.2M") for volume / market cap. */
export function formatCompact(value: number, locale?: string): string {
	return new Intl.NumberFormat(locale, {
		notation: 'compact',
		maximumFractionDigits: 1,
	}).format(value);
}
