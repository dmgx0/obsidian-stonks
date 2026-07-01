// Tiny arithmetic evaluator where bare symbols are live tickers.
//
// Scope is deliberately minimal: + - * / %, parentheses, numeric literals and
// tickers. NOT mathjs (that is Numerals' engine) — keeping this in-house means
// zero runtime deps and no overlap with Numerals' feature set.
//
// A ticker resolves to its price by default; a trailing dot-field selects
// another value (AAPL.change, VWRA.L.pct) — Excel-Stocks / Dataview style.
// Tickers (incl. `.SUFFIX`, `-PAIR`, `^INDEX`, `=X`) are tokenized before
// evaluation so a naive parser doesn't mistake `.` for a decimal point.
//
// No Obsidian imports — pure and unit-testable.

export class ExprError extends Error {}

/** Which value of a quote a ticker reference resolves to. */
export type Field = 'price' | 'change' | 'pct' | 'prev';

const FIELDS: Record<string, Field> = {
	price: 'price',
	change: 'change',
	pct: 'pct',
	prev: 'prev',
};

const TICKER_RE =
	/^\^?[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*(?:=[A-Za-z]+)?/;
const NUMBER_RE = /^\d+(?:\.\d+)?/;

/** Split a matched ticker token into symbol + optional trailing field. A final
 *  `.<reserved-field>` is the field; anything else (e.g. `.L`) stays part of the
 *  symbol, since no real exchange suffix collides with a field name. */
function splitField(matched: string): { sym: string; field: Field } {
	const dot = matched.lastIndexOf('.');
	if (dot > 0) {
		const field = FIELDS[matched.slice(dot + 1).toLowerCase()];
		if (field) {
			return { sym: matched.slice(0, dot).toUpperCase(), field };
		}
	}
	return { sym: matched.toUpperCase(), field: 'price' };
}

type Token =
	| { kind: 'num'; value: number }
	| { kind: 'tk'; sym: string; field: Field }
	| { kind: 'op'; op: string }
	| { kind: 'lparen' }
	| { kind: 'rparen' };

interface OpInfo {
	prec: number;
	rightAssoc: boolean;
	/** arity 1 = unary prefix, 2 = binary */
	arity: 1 | 2;
}

const OPS: Record<string, OpInfo> = {
	'+': { prec: 1, rightAssoc: false, arity: 2 },
	'-': { prec: 1, rightAssoc: false, arity: 2 },
	'*': { prec: 2, rightAssoc: false, arity: 2 },
	'/': { prec: 2, rightAssoc: false, arity: 2 },
	'%': { prec: 2, rightAssoc: false, arity: 2 },
	// Unary minus, internal symbol. High precedence, right-associative.
	'u-': { prec: 3, rightAssoc: true, arity: 1 },
};

function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let rest = input;
	// True when the next token should be an operand (start, after an operator,
	// or after `(`). Used to tell unary minus from binary minus.
	let expectOperand = true;

	while (rest.length > 0) {
		const ch = rest[0]!;

		if (ch === ' ' || ch === '\t') {
			rest = rest.slice(1);
			continue;
		}

		if (ch === '(') {
			tokens.push({ kind: 'lparen' });
			rest = rest.slice(1);
			expectOperand = true;
			continue;
		}

		if (ch === ')') {
			tokens.push({ kind: 'rparen' });
			rest = rest.slice(1);
			expectOperand = false;
			continue;
		}

		if ('+-*/%'.includes(ch)) {
			if (ch === '-' && expectOperand) {
				tokens.push({ kind: 'op', op: 'u-' });
			} else if (ch === '+' && expectOperand) {
				// Unary plus is a no-op; drop it.
			} else {
				if (expectOperand) {
					throw new ExprError(`Unexpected "${ch}"`);
				}
				tokens.push({ kind: 'op', op: ch });
			}
			rest = rest.slice(1);
			expectOperand = true;
			continue;
		}

		const num = NUMBER_RE.exec(rest);
		if (num && /[0-9]/.test(ch)) {
			tokens.push({ kind: 'num', value: Number(num[0]) });
			rest = rest.slice(num[0].length);
			expectOperand = false;
			continue;
		}

		const tk = TICKER_RE.exec(rest);
		if (tk) {
			const { sym, field } = splitField(tk[0]);
			tokens.push({ kind: 'tk', sym, field });
			rest = rest.slice(tk[0].length);
			expectOperand = false;
			continue;
		}

		throw new ExprError(`Unexpected "${ch}"`);
	}

	return tokens;
}

type RpnItem =
	| { kind: 'num'; value: number }
	| { kind: 'tk'; sym: string; field: Field }
	| { kind: 'op'; op: string };

/** Shunting-yard: token stream -> reverse Polish notation. */
function toRpn(tokens: Token[]): RpnItem[] {
	const output: RpnItem[] = [];
	const stack: Array<{ kind: 'op'; op: string } | { kind: 'lparen' }> = [];

	for (const t of tokens) {
		if (t.kind === 'num') {
			output.push({ kind: 'num', value: t.value });
		} else if (t.kind === 'tk') {
			output.push({ kind: 'tk', sym: t.sym, field: t.field });
		} else if (t.kind === 'op') {
			const o1 = OPS[t.op]!;
			let top = stack[stack.length - 1];
			while (
				top &&
				top.kind === 'op' &&
				(() => {
					const o2 = OPS[top.op]!;
					return (
						o2.prec > o1.prec ||
						(o2.prec === o1.prec && !o1.rightAssoc)
					);
				})()
			) {
				output.push(stack.pop() as { kind: 'op'; op: string });
				top = stack[stack.length - 1];
			}
			stack.push({ kind: 'op', op: t.op });
		} else if (t.kind === 'lparen') {
			stack.push({ kind: 'lparen' });
		} else {
			// rparen: pop until matching lparen
			let top = stack[stack.length - 1];
			while (top && top.kind !== 'lparen') {
				output.push(stack.pop() as { kind: 'op'; op: string });
				top = stack[stack.length - 1];
			}
			if (!top) {
				throw new ExprError('Mismatched parentheses');
			}
			stack.pop(); // discard the lparen
		}
	}

	while (stack.length > 0) {
		const top = stack.pop()!;
		if (top.kind === 'lparen') {
			throw new ExprError('Mismatched parentheses');
		}
		output.push(top);
	}

	return output;
}

/** Resolve a ticker field to a number. Throws (e.g. ExprError) if unavailable. */
export type Resolver = (sym: string, field: Field) => number;

function evalRpn(rpn: RpnItem[], resolve: Resolver): number {
	const stack: number[] = [];
	const pop = (): number => {
		const v = stack.pop();
		if (v === undefined) {
			throw new ExprError('Malformed expression');
		}
		return v;
	};

	for (const item of rpn) {
		if (item.kind === 'num') {
			stack.push(item.value);
		} else if (item.kind === 'tk') {
			stack.push(resolve(item.sym, item.field));
		} else {
			const info = OPS[item.op]!;
			if (info.arity === 1) {
				stack.push(-pop());
			} else {
				const b = pop();
				const a = pop();
				switch (item.op) {
					case '+':
						stack.push(a + b);
						break;
					case '-':
						stack.push(a - b);
						break;
					case '*':
						stack.push(a * b);
						break;
					case '/':
						stack.push(a / b);
						break;
					case '%':
						stack.push(a % b);
						break;
				}
			}
		}
	}

	if (stack.length !== 1) {
		throw new ExprError('Malformed expression');
	}
	return stack[0]!;
}

export interface ParsedExpression {
	/** Distinct ticker symbols referenced (uppercased, field-stripped). */
	tickers: string[];
	/** The single ticker reference if the expression is exactly one, else null.
	 *  Lets the renderer format/colour by the referenced field. */
	single: { sym: string; field: Field } | null;
	/** Compute the result given a field resolver. Propagates whatever the
	 *  resolver throws when a ticker is unavailable. */
	evaluate(resolve: Resolver): number;
}

/** Parse an inline expression body (without the trigger prefix). */
export function parseExpression(input: string): ParsedExpression {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		throw new ExprError('Empty expression');
	}

	const tokens = tokenize(trimmed);
	const rpn = toRpn(tokens);

	const tickers: string[] = [];
	for (const item of rpn) {
		if (item.kind === 'tk' && !tickers.includes(item.sym)) {
			tickers.push(item.sym);
		}
	}

	// Structural validation up front (arity / balance) with a dummy resolver, so
	// errors like "VWRA.L *" surface at parse time, before any quote resolves.
	evalRpn(rpn, () => 1);

	const first = rpn[0];
	const single =
		rpn.length === 1 && first!.kind === 'tk'
			? { sym: first!.sym, field: first!.field }
			: null;

	return {
		tickers,
		single,
		evaluate: (resolve) => evalRpn(rpn, resolve),
	};
}
