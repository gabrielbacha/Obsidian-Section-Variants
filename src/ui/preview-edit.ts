import { EditorView } from '@codemirror/view';
import { isolateNativeHistory } from '../editor/history';
import { MarkdownView } from 'obsidian';
import { previewChange } from '../core/preview-fragment';
import { STRUCTURAL_TRANSACTION_ORIGIN } from '../core/structural-transaction';
import { VariantBlock } from '../core/types';
import { chooseMutationEditor } from '../editor/mutation-target';
import { SectionVariantsHost } from '../plugin-host';

export async function applyPreviewEdit(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	label: string,
	index: number,
	before: string,
	after: string,
	origin: HTMLElement,
): Promise<void> {
	const change = (source: string) => previewChange(source, host.parse(source), block, label, index, before, after);
	// Nested previews can belong to an embedded native editor. Its dispatch
	// bridge already forwards to the original note and owns undo/redo.
	const cm = EditorView.findFromDOM(origin);
	if (cm) {
		const edit = change(cm.state.doc.toString());
		const expected = cm.state.changes(edit).apply(cm.state.doc).toString();
		cm.dispatch({ changes: edit, annotations: isolateNativeHistory.of('full') });
		if (cm.state.doc.toString() !== expected) throw new Error('Preview edit rejected.');
		return;
	}
	const views = host.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
		.filter((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === path && view.getMode() === 'source');
	const editor = chooseMutationEditor(views.map(view => ({
		editor: view.editor,
		containsOrigin: view.containerEl.contains(origin),
		sameDocument: view.containerEl.ownerDocument === origin.ownerDocument,
		active: view === host.app.workspace.getActiveViewOfType(MarkdownView),
	})));
	if (editor) {
		const source = editor.getValue();
		const edit = change(source);
		editor.transaction({ changes: [{ from: editor.offsetToPos(edit.from), to: editor.offsetToPos(edit.to), text: edit.insert }] }, STRUCTURAL_TRANSACTION_ORIGIN);
		if (editor.getValue() !== source.slice(0, edit.from) + edit.insert + source.slice(edit.to)) throw new Error('Preview edit rejected.');
	} else {
		// A Reading View's hidden editor is not its authoritative document.
		// Use the vault's atomic update when no source pane owns the note, just
		// as for a closed note; Obsidian then refreshes all reading panes.
		const file = host.app.vault.getFileByPath(path);
		if (!file) throw new Error('Preview file no longer exists.');
		await host.app.vault.process(file, source => {
			const edit = change(source);
			return source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
		});
	}
	host.refreshAllViews(path);
}
