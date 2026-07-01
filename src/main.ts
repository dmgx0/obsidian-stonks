import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PersistedData, StonksSettings } from './types';
import { readVar } from './vars';
import { YahooProvider } from './quotes';
import { QuoteCache } from './cache';
import { HistoryCache } from './history';
import { createApi, StonksAPI } from './api';
import {
	InlineRenderer,
	buildEditorExtension,
	buildReadingProcessor,
	refreshEditors,
} from './inline';
import { StonksSettingTab } from './settings';
import { StonksSuggest } from './suggest';

export default class StonksPlugin extends Plugin {
	settings!: StonksSettings;
	/** Public API for DataviewJS / Templater / JS Engine. See src/api.ts. */
	api!: StonksAPI;

	private cache!: QuoteCache;
	private renderer!: InlineRenderer;
	private refreshTimer: number | null = null;
	private persistTimer: number | null = null;
	private varsTimer: number | null = null;

	async onload(): Promise<void> {
		const data = (await this.loadData()) as Partial<PersistedData> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);

		this.cache = new QuoteCache(
			new YahooProvider(),
			this.settings.cacheTtlSeconds * 1000,
		);
		if (data?.quotes) {
			this.cache.seed(data.quotes);
		}
		this.cache.subscribe(() => this.schedulePersist());
		this.api = createApi(this.cache, new HistoryCache());
		this.renderer = new InlineRenderer(
			() => this.settings,
			this.cache,
			(sourcePath) => this.varLookup(sourcePath),
		);

		// Re-render when a note's metadata changes, so edits to properties (the
		// source of @variables) show up live. Metadata only affects @-spans, so
		// re-resolve just those — and only the ones reading the changed note
		// (or all of them when the global variables note changed). Anything
		// broader would repaint every span on every edit anywhere in the vault.
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				const changed = file.path;
				const varsNote = this.settings.variablesNote;
				const isVarsNote =
					varsNote.length > 0 &&
					(changed === varsNote || changed === `${varsNote}.md`);
				if (this.varsTimer !== null) {
					window.clearTimeout(this.varsTimer);
				}
				this.varsTimer = window.setTimeout(() => {
					this.varsTimer = null;
					this.renderer.rerenderWhere(
						(entry) =>
							entry.body.includes('@') &&
							(isVarsNote || entry.path === changed),
					);
				}, 250);
			}),
		);

		this.registerMarkdownPostProcessor(
			buildReadingProcessor(this.renderer, () => this.settings),
		);
		this.registerEditorExtension(
			buildEditorExtension(this.renderer, () => this.settings),
		);

		this.addCommand({
			id: 'refresh-quotes',
			name: 'Refresh quotes',
			callback: () => {
				void this.refreshNow();
			},
		});

		this.addSettingTab(new StonksSettingTab(this.app, this));

		this.registerEditorSuggest(
			new StonksSuggest(
				this.app,
				() => this.settings,
				this.cache,
				(path) => this.frontmatterFor(path),
				() => this.settings.variablesNote,
			),
		);

		this.setupAutoRefresh();
	}

	onunload(): void {
		this.clearTimer();
		if (this.persistTimer !== null) {
			window.clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		if (this.varsTimer !== null) {
			window.clearTimeout(this.varsTimer);
			this.varsTimer = null;
		}
		this.renderer?.clear();
		void this.persist();
	}

	/** Resolve an @variable: the note's own properties first, then the
	 *  settings-designated variables note. Key match is case-insensitive;
	 *  value-type validation happens in the expansion. */
	private varLookup(sourcePath?: string): (name: string) => unknown {
		return (name) =>
			readVar(this.frontmatterFor(sourcePath), name) ??
			readVar(this.frontmatterFor(this.settings.variablesNote), name);
	}

	private frontmatterFor(
		path?: string,
	): Record<string, unknown> | undefined {
		if (!path) {
			return undefined;
		}
		const cached =
			this.app.metadataCache.getCache(path) ??
			this.app.metadataCache.getCache(`${path}.md`);
		return cached?.frontmatter;
	}

	/** Force a refresh of every seen ticker and repaint visible spans. */
	async refreshNow(): Promise<void> {
		await this.cache.refreshAll();
		this.renderer.rerenderAll();
		refreshEditors(this.app);
	}

	async saveSettings(): Promise<void> {
		await this.persist();
		// Apply settings that have live side-effects.
		this.cache.setTtl(this.settings.cacheTtlSeconds * 1000);
		this.setupAutoRefresh();
		this.renderer.rerenderAll();
		refreshEditors(this.app);
	}

	/** Write settings + the current quote snapshot to data.json. */
	private async persist(): Promise<void> {
		await this.saveData({
			settings: this.settings,
			quotes: this.cache.snapshot(),
		});
	}

	/** Debounced persist, fired when the cache gets fresh quotes. */
	private schedulePersist(): void {
		if (this.persistTimer !== null) {
			window.clearTimeout(this.persistTimer);
		}
		this.persistTimer = window.setTimeout(() => {
			this.persistTimer = null;
			void this.persist();
		}, 2000);
	}

	private setupAutoRefresh(): void {
		this.clearTimer();
		const secs = this.settings.refreshIntervalSeconds;
		if (secs > 0) {
			this.refreshTimer = window.setInterval(() => {
				void this.refreshNow();
			}, secs * 1000);
			// Belt-and-suspenders: also clears on unload.
			this.registerInterval(this.refreshTimer);
		}
	}

	private clearTimer(): void {
		if (this.refreshTimer !== null) {
			window.clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	}
}
