import {
	App,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
} from 'obsidian';
import { SectionVariantsSettings } from './core/state-model';
import type SectionVariantsPlugin from './main';

export class SectionVariantsSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SectionVariantsPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
		return [
			{
				name: 'Default view',
				desc: 'Used when a block does not declare a view.',
				control: {
					type: 'dropdown',
					key: 'defaultView',
					options: { toggle: 'Toggle', columns: 'Columns' },
				},
			},
			definitionToggle(
				'Show sticky note control',
				'Show the note-wide control when a note contains at least two valid variants blocks.',
				'stickyControlEnabled',
			),
			definitionToggle(
				'Create block IDs automatically',
				'When persistent state is ambiguous, add an Obsidian block ID after the closing fence.',
				'automaticBlockIds',
			),
			{
				name: 'Container aliases',
				desc: 'Comma-separated class names. The canonical variants alias is always enabled.',
				control: {
					type: 'text',
					key: 'aliases',
					validate: (value) =>
						value
							.split(',')
							.map((alias) => alias.trim())
							.filter(Boolean)
							.every((alias) => /^[a-z][a-z0-9-]*$/u.test(alias))
							? undefined
							: 'Use lowercase letters, numbers, and hyphens.',
				},
			},
			{
				name: 'HTML export state',
				desc: 'Export authored defaults, or the variants currently selected in the UI.',
				control: {
					type: 'dropdown',
					key: 'exportState',
					options: {
						authored: 'Authored defaults',
						current: 'Current UI state',
					},
				},
			},
			definitionToggle(
				'Show default-difference indicators',
				'Show a subtle indicator when the current label or view differs from authored defaults.',
				'showIndicators',
			),
		];
	}

	getControlValue(key: string): unknown {
		if (key === 'aliases') return this.plugin.store.settings.aliases.join(', ');
		return this.plugin.store.settings[key as SettingKey];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'aliases') {
			const aliases = [
				'variants',
				...String(value)
					.split(',')
					.map((alias) => alias.trim())
					.filter(Boolean),
			];
			await this.savePatch({ aliases: [...new Set(aliases)] });
			return;
		}
		await this.savePatch({ [key]: value });
	}

	/**
	 * Legacy rendering path for Obsidian versions below 1.13, which do not call
	 * `getSettingDefinitions`. Derived from that same list so the two can never
	 * drift apart — they previously carried differing descriptions.
	 */
	display(): void {
		this.containerEl.empty();
		for (const definition of this.getSettingDefinitions()) {
			this.renderDefinition(definition);
		}
	}

	private renderDefinition(
		definition: SettingDefinitionItem<SettingKey>,
	): void {
		// Groups carry a heading rather than a control; this tab defines none,
		// but the type permits them.
		if (!('control' in definition)) return;
		const { control } = definition;
		if (!control) return;
		const setting = new Setting(this.containerEl).setName(definition.name);
		if (definition.desc) setting.setDesc(definition.desc);

		if (control.type === 'toggle') {
			const { key } = control;
			setting.addToggle((toggle) =>
				toggle
					.setValue(Boolean(this.getControlValue(key)))
					.onChange(async (value) => {
						await this.setControlValue(key, value);
					}),
			);
			return;
		}

		if (control.type === 'dropdown') {
			const { key, options } = control;
			setting.addDropdown((dropdown) =>
				dropdown
					.addOptions(options)
					.setValue(String(this.getControlValue(key)))
					.onChange(async (value) => {
						await this.setControlValue(key, value);
					}),
			);
			return;
		}

		// Only these three control types are used by this tab.
		if (control.type !== 'text') return;
		const { key, validate } = control;
		const baseDesc = definition.desc ?? '';
		setting.addText((text) =>
			text.setValue(String(this.getControlValue(key))).onChange(async (value) => {
				const error = await validate?.(value);
				const message = typeof error === 'string' ? error : undefined;
				setting.settingEl.toggleClass(
					'section-variants-setting-error',
					Boolean(message),
				);
				setting.setDesc(message ?? baseDesc);
				if (!message) await this.setControlValue(key, value.trim());
			}),
		);
	}

	private async savePatch(
		patch: Partial<SectionVariantsSettings>,
	): Promise<void> {
		this.plugin.store.updateSettings({
			...this.plugin.store.settings,
			...patch,
		});
		await this.plugin.store.flush();
	}
}

type SettingKey = keyof SectionVariantsSettings;

function definitionToggle(
	name: string,
	desc: string,
	key: 'stickyControlEnabled' | 'automaticBlockIds' | 'showIndicators',
): SettingDefinitionItem<SettingKey> {
	return { name, desc, control: { type: 'toggle', key } };
}
