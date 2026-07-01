import { vi } from 'vitest';

// Minimal stand-in for the Obsidian runtime so modules that import 'obsidian'
// can run under Node/jsdom. Aliased in vitest.config.ts. Only the surface the
// plugin actually uses is implemented.

export const requestUrl = vi.fn();

export class App {}
export class Plugin {}
export class Notice {
	constructor(_message?: string) {}
}
export class MarkdownView {}

export class PluginSettingTab {
	constructor(_app: unknown, _plugin: unknown) {}
	display(): void {}
}

class TextStub {
	setPlaceholder(): this {
		return this;
	}
	setValue(): this {
		return this;
	}
	onChange(): this {
		return this;
	}
}

export class Setting {
	constructor(_containerEl: unknown) {}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	addText(cb: (t: TextStub) => void): this {
		cb(new TextStub());
		return this;
	}
}

export type MarkdownPostProcessor = (
	el: HTMLElement,
	ctx?: unknown,
) => void | Promise<unknown>;

export type MarkdownPostProcessorContext = { sourcePath?: string };

export class TFile {}

export class EditorSuggest<T> {
	limit = 0;
	context: unknown = null;
	constructor(_app: unknown) {}
	close(): void {}
	declare _t: T;
}

// CM6 state field handle; only referenced by the Live-Preview path, which the
// autonomous tests do not exercise (see PLAN A5).
export const editorInfoField = {} as never;
