// Shim of the Obsidian HTMLElement helpers the renderer relies on, so jsdom
// tests exercise the real DOM. Guarded so it's a no-op under the Node env
// (where HTMLElement is undefined and these tests don't run).

if (typeof HTMLElement !== 'undefined') {
	const proto = HTMLElement.prototype as unknown as Record<
		string,
		(...args: never[]) => unknown
	>;

	proto.empty = function (this: HTMLElement) {
		while (this.firstChild) {
			this.removeChild(this.firstChild);
		}
		return this;
	};
	proto.setText = function (this: HTMLElement, text: string) {
		this.textContent = text;
		return this;
	};
	proto.setAttr = function (
		this: HTMLElement,
		name: string,
		value: string | number | boolean | null,
	) {
		if (value === null || value === false) {
			this.removeAttribute(name);
		} else {
			this.setAttribute(name, value === true ? '' : String(value));
		}
		return this;
	};
	proto.addClass = function (this: HTMLElement, ...cls: string[]) {
		this.classList.add(...cls);
		return this;
	};
	proto.addClasses = function (this: HTMLElement, cls: string[]) {
		this.classList.add(...cls);
		return this;
	};
	proto.removeClass = function (this: HTMLElement, ...cls: string[]) {
		this.classList.remove(...cls);
		return this;
	};
	proto.removeClasses = function (this: HTMLElement, cls: string[]) {
		this.classList.remove(...cls);
		return this;
	};
	proto.toggleClass = function (
		this: HTMLElement,
		cls: string,
		value: boolean,
	) {
		this.classList.toggle(cls, value);
		return this;
	};
	proto.hasClass = function (this: HTMLElement, cls: string) {
		return this.classList.contains(cls);
	};
	proto.find = function (this: HTMLElement, sel: string) {
		return this.querySelector(sel);
	};
	proto.findAll = function (this: HTMLElement, sel: string) {
		return Array.from(this.querySelectorAll(sel));
	};

	interface ElOpts {
		cls?: string | string[];
		text?: string;
		attr?: Record<string, string>;
	}
	const createEl = (tag: string, o?: ElOpts): HTMLElement => {
		const el = document.createElement(tag);
		if (o?.cls) {
			if (Array.isArray(o.cls)) {
				el.classList.add(...o.cls);
			} else {
				el.classList.add(o.cls);
			}
		}
		if (o?.text) {
			el.textContent = o.text;
		}
		if (o?.attr) {
			for (const k of Object.keys(o.attr)) {
				el.setAttribute(k, o.attr[k]!);
			}
		}
		return el;
	};
	proto.createEl = function (this: HTMLElement, tag: string, o?: ElOpts) {
		const child = createEl(tag, o);
		this.appendChild(child);
		return child;
	};
	proto.createSpan = function (this: HTMLElement, o?: ElOpts) {
		return (this as unknown as { createEl: typeof createEl }).createEl(
			'span',
			o,
		);
	};
	proto.createDiv = function (this: HTMLElement, o?: ElOpts) {
		return (this as unknown as { createEl: typeof createEl }).createEl(
			'div',
			o,
		);
	};

	const g = globalThis as unknown as Record<string, unknown>;
	g.createEl = createEl;
	g.createSpan = (o?: ElOpts) => createEl('span', o);
	g.createDiv = (o?: ElOpts) => createEl('div', o);
}
