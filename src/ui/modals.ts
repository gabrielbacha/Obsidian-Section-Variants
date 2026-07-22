import { App, Modal, Setting } from 'obsidian';
import {
	normalizeLabel,
	SerializeOptions,
	VariantBlock,
	ViewMode,
} from '../core/types';
import { errorMessage } from '../core/errors';
import { LabelCatalogEntry } from '../core/labels';
import {
	parseColumnRatios,
	serializeColumnRatios,
} from '../core/column-ratios';
import { LabelInputSuggest } from './label-input-suggest';

export class InsertVariantsModal extends Modal {
	private name = '';
	private labels = ['A', 'B'];
	private defaultIndex = 0;
	private view: ViewMode = 'toggle';
	private errorEl?: HTMLElement;
	private labelSuggests: LabelInputSuggest[] = [];

	constructor(
		app: App,
		private readonly suggestions: readonly LabelCatalogEntry[],
		private readonly onSubmit: (options: SerializeOptions) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Insert variants block');
		this.render();
	}

	onClose(): void {
		this.clearLabelSuggests();
		this.contentEl.empty();
	}

	private render(): void {
		this.clearLabelSuggests();
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: 'Add at least two unique labels. Labels with spaces are generated in explicit pandoc form.',
		});
		new Setting(this.contentEl)
			.setName('Box name')
			.setDesc('Optional title shown above the variants.')
			.addText((text) =>
				text.setValue(this.name).onChange((value) => {
					this.name = value;
				}),
			);
		this.labels.forEach((label, index) => this.renderLabelSetting(label, index));

		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText('Add variant').setIcon('plus').onClick(() => {
				this.labels.push(nextAvailableLabel(this.labels));
				this.render();
			}),
		);

		new Setting(this.contentEl)
			.setName('Default variant')
			.addDropdown((dropdown) => {
				this.labels.forEach((label, index) => {
					dropdown.addOption(String(index), label || `Variant ${index + 1}`);
				});
				dropdown.setValue(String(this.defaultIndex)).onChange((value) => {
					this.defaultIndex = Number(value);
				});
			});

		new Setting(this.contentEl)
			.setName('Default view')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ toggle: 'Toggle', columns: 'Columns' })
					.setValue(this.view)
					.onChange((value) => {
						this.view = value as ViewMode;
					}),
			);

		this.errorEl = this.contentEl.createDiv({ cls: 'section-variants-modal-error' });
		this.errorEl.setAttribute('role', 'alert');
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText('Insert')
					.setCta()
					.onClick(() => this.submit()),
			);
	}

	private renderLabelSetting(label: string, index: number): void {
		new Setting(this.contentEl)
			.setName(`Variant ${index + 1}`)
			.addText((text) => {
				text.setValue(label).onChange((value) => {
					this.labels[index] = value;
				});
				this.labelSuggests.push(
					new LabelInputSuggest(
						this.app,
						text.inputEl,
						this.suggestions,
						() => new Set(
							this.labels
								.filter((_item, itemIndex) => itemIndex !== index)
								.map(normalizeLabel),
						),
						(value) => {
							this.labels[index] = value;
						},
					),
				);
			})
			.addExtraButton((button) =>
				button
					.setIcon('trash-2')
					.setTooltip(`Remove variant ${index + 1}`)
					.setDisabled(this.labels.length <= 2)
					.onClick(() => {
						this.labels.splice(index, 1);
						this.defaultIndex = Math.min(
							this.defaultIndex,
							this.labels.length - 1,
						);
						this.render();
					}),
			);
	}

	private submit(): void {
		const labels = this.labels.map((label) => label.trim());
		const normalized = labels.map(normalizeLabel);
		if (labels.some((label) => !label)) {
			this.showError('Every variant needs a label.');
			return;
		}
		if (new Set(normalized).size !== labels.length) {
			this.showError('Labels must be unique, ignoring case.');
			return;
		}
		this.onSubmit({
			labels,
			name: this.name.trim() || undefined,
			defaultLabel: labels[this.defaultIndex],
			view: this.view,
		});
		this.close();
	}

	private showError(message: string): void {
		this.errorEl?.setText(message);
	}

	private clearLabelSuggests(): void {
		for (const suggest of this.labelSuggests) suggest.destroy();
		this.labelSuggests = [];
	}
}

export class ColumnRatiosModal extends Modal {
	private ratios: string[];
	private errorEl?: HTMLElement;

	constructor(
		app: App,
		private readonly block: VariantBlock,
		private readonly onSubmit: (widths: string | undefined) => Promise<void>,
	) {
		super(app);
		this.ratios = (
			parseColumnRatios(block.attributes.widths, block.variants.length) ??
			Array.from({ length: block.variants.length }, () => 1)
		).map(String);
	}

	onOpen(): void {
		this.setTitle('Edit column relative widths');
		new Setting(this.contentEl)
			.setName('Column ratios')
			.setDesc('Set the relative share for each variant. Equal values split the box evenly.');
		this.block.variants.forEach((variant, index) => {
			new Setting(this.contentEl)
				.setName(variant.label)
				.setDesc('Relative width')
				.addText((text) => {
					text.inputEl.type = 'number';
					text.inputEl.min = '0.1';
					text.inputEl.step = '0.1';
					text.setValue(this.ratios[index] ?? '1').onChange((value) => {
						this.ratios[index] = value;
					});
				});
		});
		this.errorEl = this.contentEl.createDiv({ cls: 'section-variants-modal-error' });
		this.errorEl.setAttribute('role', 'alert');
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText('Save widths')
					.setCta()
					.onClick(() => void this.submit()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const ratios = this.ratios.map(Number);
		if (ratios.some((value) => !Number.isFinite(value) || value <= 0)) {
			this.errorEl?.setText('Every column ratio must be greater than zero.');
			return;
		}
		try {
			await this.onSubmit(serializeColumnRatios(ratios));
			this.close();
		} catch (error) {
			this.errorEl?.setText(errorMessage(error));
		}
	}
}

export class RenameVariantModal extends Modal {
	private newLabel: string;
	private acrossNote = false;
	private errorEl?: HTMLElement;

	constructor(
		app: App,
		private readonly oldLabel: string,
		private readonly onSubmit: (
			oldLabel: string,
			newLabel: string,
			acrossNote: boolean,
		) => Promise<void>,
	) {
		super(app);
		this.newLabel = this.oldLabel;
	}

	onOpen(): void {
		this.setTitle(`Rename ${this.oldLabel}`);
		this.display();
	}

	private display(): void {
		this.contentEl.querySelector('.section-variants-rename-fields')?.remove();
		const fields = this.contentEl.createDiv({ cls: 'section-variants-rename-fields' });
		new Setting(fields).setName('New label').addText((text) =>
			text.setValue(this.newLabel).onChange((value) => {
				this.newLabel = value;
			}),
		);
		new Setting(fields).setName('Scope').addDropdown((dropdown) =>
			dropdown
				.addOptions({ block: 'This block', note: 'Current note' })
				.setValue(this.acrossNote ? 'note' : 'block')
				.onChange((value) => {
					this.acrossNote = value === 'note';
				}),
		);
		this.errorEl = fields.createDiv({ cls: 'section-variants-modal-error' });
		this.errorEl.setAttribute('role', 'alert');
		new Setting(fields)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText('Rename')
					.setCta()
					.onClick(() => void this.submit()),
			);
	}

	private async submit(): Promise<void> {
		try {
			await this.onSubmit(
				this.oldLabel,
				this.newLabel.trim(),
				this.acrossNote,
			);
			this.close();
		} catch (error) {
			this.errorEl?.setText(errorMessage(error));
		}
	}
}

export class AddVariantModal extends Modal {
	private label: string;
	private errorEl?: HTMLElement;
	private labelSuggest?: LabelInputSuggest;

	constructor(
		app: App,
		private readonly block: VariantBlock,
		private readonly suggestions: readonly LabelCatalogEntry[],
		private readonly onSubmit: (label: string) => Promise<void>,
	) {
		super(app);
		this.label = nextAvailableLabel(
			block.variants.map((variant) => variant.label),
		);
	}

	onOpen(): void {
		this.setTitle('Add variant');
		new Setting(this.contentEl).setName('Variant label').addText((text) => {
			text.setValue(this.label).onChange((value) => {
				this.label = value;
			});
			this.labelSuggest = new LabelInputSuggest(
				this.app,
				text.inputEl,
				this.suggestions,
				() => new Set(
					this.block.variants.map((variant) => variant.normalizedLabel),
				),
				(value) => {
					this.label = value;
				},
			);
		});
		this.errorEl = this.contentEl.createDiv({ cls: 'section-variants-modal-error' });
		this.errorEl.setAttribute('role', 'alert');
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText('Add variant')
					.setCta()
					.onClick(() => void this.submit()),
			);
	}

	onClose(): void {
		this.labelSuggest?.destroy();
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const label = this.label.trim();
		if (!label || /[\r\n]/u.test(label)) {
			this.errorEl?.setText('Enter a nonempty label on one line.');
			return;
		}
		if (
			this.block.variants.some(
				(variant) => variant.normalizedLabel === normalizeLabel(label),
			)
		) {
			this.errorEl?.setText('That label already exists in this box.');
			return;
		}
		try {
			await this.onSubmit(label);
			this.close();
		} catch (error) {
			this.errorEl?.setText(errorMessage(error));
		}
	}
}

export class DeleteVariantConfirmationModal extends Modal {
	private errorEl?: HTMLElement;

	constructor(
		app: App,
		private readonly label: string,
		private readonly onConfirm: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(`Delete ${this.label}?`);
		this.contentEl.createEl('p', {
			text: `This permanently deletes the ${this.label} variant and all of its content from the note.`,
		});
		this.errorEl = this.contentEl.createDiv({ cls: 'section-variants-modal-error' });
		this.errorEl.setAttribute('role', 'alert');
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText('Delete variant')
					.setClass('mod-warning')
					.setCta()
					.onClick(() => void this.confirm()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async confirm(): Promise<void> {
		try {
			await this.onConfirm();
			this.close();
		} catch (error) {
			this.errorEl?.setText(errorMessage(error));
		}
	}
}

export class DeleteBlockConfirmationModal extends Modal {
	private errorEl?: HTMLElement;

	constructor(
		app: App,
		private readonly name: string | undefined,
		private readonly onConfirm: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.name ? `Delete ${this.name}?` : 'Delete variants box?');
		this.contentEl.createEl('p', {
			text: 'This permanently deletes the entire box, every variant, and all of their content from the note.',
		});
		this.errorEl = this.contentEl.createDiv({ cls: 'section-variants-modal-error' });
		this.errorEl.setAttribute('role', 'alert');
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText('Delete box')
					.setClass('mod-warning')
					.setCta()
					.onClick(() => void this.confirm()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async confirm(): Promise<void> {
		try {
			await this.onConfirm();
			this.close();
		} catch (error) {
			this.errorEl?.setText(errorMessage(error));
		}
	}
}

function nextLabel(index: number): string {
	return index < 26 ? String.fromCharCode(65 + index) : `Variant ${index + 1}`;
}

function nextAvailableLabel(labels: readonly string[]): string {
	const used = new Set(labels.map(normalizeLabel));
	for (let index = 0; ; index += 1) {
		const label = nextLabel(index);
		if (!used.has(normalizeLabel(label))) return label;
	}
}
