import {
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from 'obsidian';
import { normalizeLabel } from '../core/types';
import { SectionVariantsHost } from '../plugin-host';

interface Suggestion {
	type: 'insert' | 'label';
	label: string;
	description: string;
}

export class VariantsEditorSuggest extends EditorSuggest<Suggestion> {
	private mode: Suggestion['type'] = 'label';
	private recentLabels: string[] = [];

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

		const counts = new Map<string, { label: string; count: number }>();
		for (const block of this.host.parse(context.editor.getValue()).blocks) {
			for (const variant of block.variants) {
				const existing = counts.get(variant.normalizedLabel);
				if (existing) existing.count += 1;
				else counts.set(variant.normalizedLabel, { label: variant.label, count: 1 });
			}
		}
		const query = normalizeLabel(context.query);
		return [...counts.values()]
			.filter((entry) => normalizeLabel(entry.label).includes(query))
			.sort((left, right) => {
				const frequency = right.count - left.count;
				if (frequency !== 0) return frequency;
				return recentIndex(this.recentLabels, left.label) - recentIndex(this.recentLabels, right.label);
			})
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
			this.recentLabels = [
				suggestion.label,
				...this.recentLabels.filter(
					(label) => normalizeLabel(label) !== normalizeLabel(suggestion.label),
				),
			].slice(0, 20);
		}
		this.close();
	}
}

function recentIndex(labels: string[], label: string): number {
	const index = labels.findIndex(
		(candidate) => normalizeLabel(candidate) === normalizeLabel(label),
	);
	return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
