import {
	EditorSelection,
	EditorState,
	Extension,
	StateEffect,
	Transaction,
} from '@codemirror/state';

/**
 * Create a fragment editor with the owning editor's current configuration.
 * Updating the owner state into a fragment preserves Obsidian's configured
 * Markdown language, Live Preview state fields, theme compartments, and other
 * editor behavior without reaching into CodeMirror's private configuration.
 */
export function deriveFragmentState(
	owner: EditorState,
	markdown: string,
	additionalExtensions: Extension,
): EditorState {
	const fragment = owner.update({
		changes: { from: 0, to: owner.doc.length, insert: markdown },
		selection: EditorSelection.cursor(0),
		annotations: Transaction.addToHistory.of(false),
	}).state;
	return fragment.update({
		effects: StateEffect.appendConfig.of(additionalExtensions),
	}).state;
}
