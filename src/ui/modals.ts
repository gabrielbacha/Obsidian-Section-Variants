import { App, Modal, Setting } from 'obsidian';
import { SerializeOptions, VariantBlock, ViewMode } from '../core/types';
import { errorMessage } from '../core/errors';

export class InsertVariantsModal extends Modal {
	private labels = ['A', 'B'];
	private defaultIndex = 0;
	private view: ViewMode = 'toggle';
	private errorEl?: HTMLElement;

	constructor(
		app: App,
		private readonly onSubmit: (options: SerializeOptions) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Insert variants block');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: 'Add at least two unique labels. Labels with spaces are generated in explicit pandoc form.',
		});
		this.labels.forEach((label, index) => this.renderLabelSetting(label, index));

		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText('Add variant').setIcon('plus').onClick(() => {
				this.labels.push(nextLabel(this.labels.length));
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
					.addOptions({ toggle: 'Toggle', columns: 'Columns', auto: 'Auto' })
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
			.addText((text) =>
				text.setValue(label).onChange((value) => {
					this.labels[index] = value;
				}),
			)
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
		const normalized = labels.map((label) => label.toLocaleLowerCase());
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
			defaultLabel: labels[this.defaultIndex],
			view: this.view,
		});
		this.close();
	}

	private showError(message: string): void {
		this.errorEl?.setText(message);
	}
}

export class BlockConfigurationModal extends Modal {
	private defaultLabel: string;
	private view: ViewMode;
	private widths: string;
	private minWidth: string;
	private responsive: 'responsive' | 'stack' | 'scroll';
	private errorEl?: HTMLElement;

	constructor(
		app: App,
		private readonly block: VariantBlock,
		private readonly onSubmit: (
			attributes: VariantBlock['attributes'],
		) => Promise<void>,
	) {
		super(app);
		this.defaultLabel = block.attributes.defaultLabel ?? block.variants[0]?.label ?? '';
		this.view = block.attributes.view ?? 'toggle';
		this.widths = block.attributes.widths ?? '';
		this.minWidth = block.attributes.minWidth ?? '';
		this.responsive = block.attributes.responsive ?? 'responsive';
	}

	onOpen(): void {
		this.setTitle('Configure variants block');
		new Setting(this.contentEl)
			.setName('Authored default')
			.addDropdown((dropdown) => {
				for (const variant of this.block.variants) {
					dropdown.addOption(variant.label, variant.label);
				}
				dropdown.setValue(this.defaultLabel).onChange((value) => {
					this.defaultLabel = value;
				});
			});
		new Setting(this.contentEl)
			.setName('Authored view')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ toggle: 'Toggle', columns: 'Columns', auto: 'Auto' })
					.setValue(this.view)
					.onChange((value) => {
						this.view = value as ViewMode;
					}),
			);
		new Setting(this.contentEl)
			.setName('Column widths')
			.setDesc('Optional CSS grid tracks, such as 40% 60% or 320px 1fr.')
			.addText((text) =>
				text.setValue(this.widths).onChange((value) => {
					this.widths = value.trim();
				}),
			);
		new Setting(this.contentEl)
			.setName('Minimum width')
			.setDesc('Leave blank to use the vault default.')
			.addText((text) =>
				text.setValue(this.minWidth).onChange((value) => {
					this.minWidth = value.trim();
				}),
			);
		new Setting(this.contentEl)
			.setName('Responsive behavior')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						responsive: 'Responsive wrap',
						stack: 'Stack',
						scroll: 'Horizontal scroll',
					})
					.setValue(this.responsive)
					.onChange((value) => {
						this.responsive = value as typeof this.responsive;
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
					.setButtonText('Save authored defaults')
					.setCta()
					.onClick(() => void this.submit()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (
			this.minWidth &&
			!/^\d+(?:\.\d+)?(?:px|rem|em|ch)$/u.test(this.minWidth)
		) {
			this.errorEl?.setText('Minimum width must look like 320px or 20rem.');
			return;
		}
		if (
			this.widths &&
			(/[;{}]/u.test(this.widths) ||
				!window.CSS?.supports('grid-template-columns', this.widths))
		) {
			this.errorEl?.setText('Enter valid CSS grid column tracks.');
			return;
		}
		try {
			await this.onSubmit({
				...this.block.attributes,
				defaultLabel: this.defaultLabel,
				view: this.view,
				widths: this.widths || undefined,
				minWidth: this.minWidth || undefined,
				responsive: this.responsive,
			});
			this.close();
		} catch (error) {
			this.errorEl?.setText(errorMessage(error));
		}
	}
}

export class RenameVariantModal extends Modal {
	private oldLabel: string;
	private newLabel: string;
	private acrossNote = false;
	private errorEl?: HTMLElement;

	constructor(
		app: App,
		private readonly block: VariantBlock,
		private readonly onSubmit: (
			oldLabel: string,
			newLabel: string,
			acrossNote: boolean,
		) => Promise<void>,
	) {
		super(app);
		this.oldLabel = block.variants[0]?.label ?? '';
		this.newLabel = this.oldLabel;
	}

	onOpen(): void {
		this.setTitle('Rename variant');
		new Setting(this.contentEl).setName('Variant').addDropdown((dropdown) => {
			for (const variant of this.block.variants) {
				dropdown.addOption(variant.label, variant.label);
			}
			dropdown.setValue(this.oldLabel).onChange((value) => {
				this.oldLabel = value;
				this.newLabel = value;
				this.display();
			});
		});
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

function nextLabel(index: number): string {
	return index < 26 ? String.fromCharCode(65 + index) : `Variant ${index + 1}`;
}

