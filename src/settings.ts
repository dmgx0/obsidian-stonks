import { App, PluginSettingTab, Setting } from 'obsidian';
import type StonksPlugin from './main';

export interface NumberRule {
	min: number;
	max?: number;
	integer?: boolean;
}

/**
 * Parse + validate a numeric settings input. Returns the number when valid,
 * else null (so the caller can show feedback and skip the save). Pure +
 * exported for tests.
 */
export function parseNumberSetting(raw: string, rule: NumberRule): number | null {
	if (raw.trim() === '') {
		return null;
	}
	const n = Number(raw);
	if (!Number.isFinite(n)) {
		return null;
	}
	if (rule.integer && !Number.isInteger(n)) {
		return null;
	}
	if (n < rule.min) {
		return null;
	}
	if (rule.max !== undefined && n > rule.max) {
		return null;
	}
	return n;
}

function describeRule(rule: NumberRule): string {
	const kind = rule.integer ? 'a whole number' : 'a number';
	return rule.max !== undefined
		? `Enter ${kind} from ${rule.min} to ${rule.max}.`
		: `Enter ${kind} of ${rule.min} or more.`;
}

// Inline prefixes claimed by other popular plugins. Stonks namespaces its own
// (`$:`) to stay clear of these; this list lets the settings tab warn if the
// user picks a prefix that would fight one of them for the same span.
const KNOWN_PREFIX_CONFLICTS: Record<string, string> = {
	'=': 'Dataview',
	'$=': 'Dataview',
	'#:': 'Numerals',
	'#=:': 'Numerals',
};

/**
 * Name of a known plugin whose inline prefix would clash with `prefix`, or
 * null. A clash means one prefix is a prefix of the other, so both plugins
 * would try to claim the same inline span. Pure + exported for tests.
 */
export function conflictingPlugin(prefix: string): string | null {
	const p = prefix.trim();
	if (!p) {
		return null;
	}
	for (const [other, name] of Object.entries(KNOWN_PREFIX_CONFLICTS)) {
		if (p === other || p.startsWith(other) || other.startsWith(p)) {
			return name;
		}
	}
	return null;
}

export class StonksSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: StonksPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const prefixSetting = new Setting(containerEl)
			.setName('Trigger prefix')
			.setDesc(
				'Inline code starting with this becomes a live quote. Default is "$:". Use something no other inline-code plugin claims.',
			);
		const prefixNote = prefixSetting.descEl.createDiv({
			cls: 'stonks-setting-warn',
		});
		const showConflict = (prefix: string): void => {
			const conflict = conflictingPlugin(prefix);
			prefixNote.setText(
				conflict
					? `Heads up: "${prefix}" can clash with ${conflict}. Pick a prefix no other plugin uses.`
					: '',
			);
		};
		showConflict(this.plugin.settings.prefix);
		prefixSetting.addText((text) =>
			text
				.setPlaceholder('$:')
				.setValue(this.plugin.settings.prefix)
				.onChange(async (value) => {
					const prefix = value.trim() || '$:';
					this.plugin.settings.prefix = prefix;
					showConflict(prefix);
					await this.plugin.saveSettings();
				}),
		);

		this.numberSetting({
			name: 'Cache lifetime',
			desc: 'Seconds a fetched quote stays fresh before it is re-fetched.',
			get: () => this.plugin.settings.cacheTtlSeconds,
			set: (n) => {
				this.plugin.settings.cacheTtlSeconds = n;
			},
			rule: { min: 0 },
		});

		this.numberSetting({
			name: 'Auto-refresh interval',
			desc: 'Seconds between background refreshes. Set to 0 to turn it off.',
			get: () => this.plugin.settings.refreshIntervalSeconds,
			set: (n) => {
				this.plugin.settings.refreshIntervalSeconds = n;
			},
			rule: { min: 0 },
		});

		this.numberSetting({
			name: 'Decimal places',
			desc: 'Decimals shown for expression results.',
			get: () => this.plugin.settings.decimals,
			set: (n) => {
				this.plugin.settings.decimals = n;
			},
			rule: { min: 0, max: 8, integer: true },
		});

		new Setting(containerEl)
			.setName('Variables note')
			.setDesc(
				'Path to a note whose properties act as vault-wide @variables in expressions. Properties of the note an expression lives in always win. Leave empty for none.',
			)
			.addText((text) =>
				text
					.setPlaceholder('finance/variables.md')
					.setValue(this.plugin.settings.variablesNote)
					.onChange(async (value) => {
						this.plugin.settings.variablesNote = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}

	/** A numeric text setting with inline validation feedback. */
	private numberSetting(opts: {
		name: string;
		desc: string;
		get: () => number;
		set: (n: number) => void;
		rule: NumberRule;
	}): void {
		const setting = new Setting(this.containerEl)
			.setName(opts.name)
			.setDesc(opts.desc);
		const error = setting.descEl.createDiv({ cls: 'stonks-setting-error' });
		setting.addText((text) => {
			text.setValue(String(opts.get()));
			text.onChange(async (raw) => {
				const n = parseNumberSetting(raw, opts.rule);
				const valid = n !== null;
				text.inputEl.toggleClass('stonks-input-invalid', !valid);
				error.setText(valid ? '' : describeRule(opts.rule));
				if (valid) {
					opts.set(n);
					await this.plugin.saveSettings();
				}
			});
		});
	}
}
