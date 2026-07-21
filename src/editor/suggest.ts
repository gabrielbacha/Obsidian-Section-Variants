import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from 'obsidian';
import { collectLabelCatalog, filterLabelCatalog } from '../core/labels';
import { SectionVariantsHost } from '../plugin-host';

interface Suggestion {
	type: 'insert' | 'label';
	label: string;
	description: string;
}

export class VariantsEditorSuggest extends EditorSuggest<Suggestion> {
	private mode: Suggestion['type'] = 'label';

	constructor(
		private readonly host: SectionVariantsHost,
		private readonly openInsertModal: (
			editor: Editor,
			position: EditorPosition,
		) => void,
	) {
		super(host.app);
		this.setInstructions([
			{ command: '↵', purpose: 'Select' },
			{ command: 'Esc', purpose: 'Dismiss' },
		]);
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const slash = before.match(/^(\s*)\/variants(?:\s+.*)?$/u);
		if (slash) {
			this.mode = 'insert';
			return {
				start: { line: cursor.line, ch: slash[1]?.length ?? 0 },
				end: cursor,
				query: before.trim(),
			};
		}
		const fenceInsert = before.match(/^(\s*):::\s+variants$/u);
		if (fenceInsert) {
			this.mode = 'insert';
			return {
				start: { line: cursor.line, ch: fenceInsert[1]?.length ?? 0 },
				end: cursor,
				query: 'variants',
			};
		}
		const label = before.match(/^(\s*:::\s+)([^{}]*)$/u);
		if (!label?.[1]) return null;
		const offset = editor.posToOffset(cursor);
		const insideVariants = this.host
			.parse(editor.getValue())
			.blocks.some(
				(block) => offset > block.opening.to && offset <= block.range.to,
			);
		if (!insideVariants) return null;
		this.mode = 'label';
		return {
			start: { line: cursor.line, ch: label[1].length },
			end: cursor,
			query: label[2] ?? '',
		};
	}

	getSuggestions(context: EditorSuggestContext): Suggestion[] {
		if (this.mode === 'insert') {
			return [
				{
					type: 'insert',
					label: 'Insert variants block',
					description: 'Configure labels and authored defaults',
				},
			];
		}

		return filterLabelCatalog(
			collectLabelCatalog(this.host.parse(context.editor.getValue()).blocks),
			context.query,
			new Set(),
		)
			.map((entry) => ({
				type: 'label',
				label: entry.label,
				description: `${entry.count} use${entry.count === 1 ? '' : 's'} in this note`,
			}));
	}

	renderSuggestion(suggestion: Suggestion, el: HTMLElement): void {
		el.createDiv({ text: suggestion.label });
		el.createEl('small', { text: suggestion.description });
	}

	selectSuggestion(suggestion: Suggestion): void {
		const context = this.context;
		if (!context) return;
		if (suggestion.type === 'insert') {
			context.editor.replaceRange('', context.start, context.end);
			this.openInsertModal(context.editor, context.start);
		} else {
			context.editor.replaceRange(suggestion.label, context.start, context.end);
		}
		this.close();
	}
}
