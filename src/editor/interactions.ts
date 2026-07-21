import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export function dispatchAndRestoreFocus(
	view: Pick<EditorView, 'dispatch' | 'focus' | 'hasFocus'>,
	spec: TransactionSpec,
): void {
	const hadFocus = view.hasFocus;
	view.dispatch(spec);
	if (hadFocus) view.focus();
}

export function isNoteWideSelection(event: Pick<MouseEvent, 'shiftKey'>): boolean {
	return event.shiftKey;
}
