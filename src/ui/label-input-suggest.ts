import { AbstractInputSuggest, App } from 'obsidian';
import {
	filterLabelCatalog,
	LabelCatalogEntry,
} from '../core/labels';

export class LabelInputSuggest extends AbstractInputSuggest<LabelCatalogEntry> {
	private showAll = false;
	private readonly focusListener = (): void => {
		this.showAll = true;
		this.input.select();
		this.open();
	};
	private readonly inputListener = (): void => {
		this.showAll = false;
	};

	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly entries: readonly LabelCatalogEntry[],
		private readonly excluded: () => ReadonlySet<string>,
		private readonly onChoose: (label: string) => void,
	) {
		super(app, input);
		input.addEventListener('focus', this.focusListener, { capture: true });
		input.addEventListener('input', this.inputListener, { capture: true });
	}

	destroy(): void {
		this.input.removeEventListener('focus', this.focusListener, true);
		this.input.removeEventListener('input', this.inputListener, true);
		this.close();
	}

	protected getSuggestions(query: string): LabelCatalogEntry[] {
		return filterLabelCatalog(
			this.entries,
			this.showAll ? '' : query,
			this.excluded(),
		);
	}

	renderSuggestion(entry: LabelCatalogEntry, element: HTMLElement): void {
		element.createDiv({ text: entry.label });
		element.createEl('small', {
			text: `${entry.count} use${entry.count === 1 ? '' : 's'} in this note`,
		});
	}

	selectSuggestion(entry: LabelCatalogEntry): void {
		this.setValue(entry.label);
		this.onChoose(entry.label);
		this.close();
	}
}
