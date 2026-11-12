import {serializeVariantOpening} from '../core/serializer';
import {findBlockAtOffset,findVariantAtOffset} from '../core/types';
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
			end?:EditorPosition,
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
		const label = before.match(/^( {0,3}:{3,}\s+)([^{}]*)$/u);
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
			start: { line: cursor.line, ch: 0 },
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

		const parsed=this.host.parse(context.editor.getValue());
		const block=findBlockAtOffset(parsed,context.editor.posToOffset(context.end));
		const current=block&&findVariantAtOffset(block,context.editor.posToOffset(context.end));
		const excluded=new Set(block?.variants.filter(variant=>variant!==current&&variant.opening.lineStart!==context.start.line).map(variant=>variant.normalizedLabel));
		return filterLabelCatalog(
			collectLabelCatalog(parsed.blocks),
			context.query,
			excluded,
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
			this.openInsertModal(context.editor, context.start,context.end);
		} else {
			const line=context.editor.getLine(context.start.line);const marker=line.match(/^( {0,3})(:{3,})/u);
			if(!marker?.[2])return;
			context.editor.replaceRange((marker[1]??'')+serializeVariantOpening(marker[2].length,suggestion.label),context.start,context.end);
		}
		this.close();
	}
}
