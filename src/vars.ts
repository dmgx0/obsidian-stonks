// Frontmatter variables: `@name` in an expression resolves to a value from the
// note's properties. A number property is a literal; a string property is
// itself a Stonks expression (an alias), expanded recursively. Expansion is
// textual and happens BEFORE the expression parser, with every substitution
// parenthesised so operator precedence survives (`@p - 100` where p = "A + B"
// becomes "(A + B) - 100").
//
// Pure — no Obsidian imports. The lookup function is injected; how properties
// are found (note-local, a global variables note, case-insensitivity) is the
// caller's concern.

import { ExprError } from './eval';

/** Resolve a variable name to its raw frontmatter value (or undefined).
 *  Values are validated by the expansion itself, so a lookup should report
 *  presence, not filter types — that way a boolean property gets the typed
 *  "must be a number or text" error instead of "unknown variable". */
export type VarLookup = (name: string) => unknown;

/** Read one variable from a frontmatter object: exact key first, then a
 *  case-insensitive scan. Presence-based — no type filtering (see VarLookup). */
export function readVar(
	fm: Record<string, unknown> | undefined,
	name: string,
): unknown {
	if (!fm) {
		return undefined;
	}
	if (name in fm) {
		return fm[name];
	}
	const lower = name.toLowerCase();
	const key = Object.keys(fm).find((k) => k.toLowerCase() === lower);
	return key === undefined ? undefined : fm[key];
}

/** Merge variable maps for display (autocomplete): later maps win, and a
 *  later key also shadows earlier keys that differ only by case — mirroring
 *  readVar's case-insensitive resolution, so previews match what an
 *  expression will actually use. */
export function mergeVars(
	...maps: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
	const byLower = new Map<string, [string, unknown]>();
	for (const map of maps) {
		for (const [key, value] of Object.entries(map ?? {})) {
			byLower.set(key.toLowerCase(), [key, value]);
		}
	}
	return Object.fromEntries(byLower.values());
}

// Same trailing-dash convention as tickers: dashes are part of the name
// (kebab-case keys), so "put spaces around a minus" applies here too.
const VAR_RE = /@([A-Za-z_][A-Za-z0-9_-]*)/g;

// Depth cap doubles as the cycle guard for textual expansion — a self- or
// mutually-referencing alias keeps re-expanding until it trips this.
const MAX_DEPTH = 16;

/** Expand every `@name` in `input`. Throws ExprError on an unknown name, a
 *  non-number/string value, or a (likely circular) too-deep alias chain. */
export function expandVariables(
	input: string,
	lookup: VarLookup,
	depth = 0,
): string {
	if (!input.includes('@')) {
		return input;
	}
	if (depth >= MAX_DEPTH) {
		throw new ExprError('Circular variable reference');
	}
	return input.replace(VAR_RE, (_match, name: string) => {
		const value = lookup(name);
		if (value === undefined) {
			throw new ExprError(`Unknown variable "@${name}"`);
		}
		if (typeof value === 'number') {
			if (!Number.isFinite(value)) {
				throw new ExprError(`Variable "@${name}" is not a finite number`);
			}
			return `(${plainNumber(value, name)})`;
		}
		if (typeof value === 'string') {
			return `(${expandVariables(value, lookup, depth + 1)})`;
		}
		throw new ExprError(`Variable "@${name}" must be a number or text`);
	});
}

/** Render a number without exponential notation — `String(1e-7)` would leak
 *  an `e` the expression tokenizer reads as a ticker. toFixed(20)-and-trim
 *  covers the small end; magnitudes at or beyond 1e21 (where toFixed itself
 *  goes exponential) are rejected as out of scope for portfolio math. */
function plainNumber(value: number, name: string): string {
	const plain = String(value);
	if (!/[eE]/.test(plain)) {
		return plain;
	}
	if (Math.abs(value) >= 1e21) {
		throw new ExprError(`Variable "@${name}" is too large to use`);
	}
	return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}
