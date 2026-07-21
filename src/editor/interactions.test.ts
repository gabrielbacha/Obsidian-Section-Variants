import { describe, expect, it, vi } from 'vitest';
import { dispatchAndRestoreFocus, isNoteWideSelection } from './interactions';

describe('Live Preview control interactions', () => {
	it('restores editor focus only when it was focused before dispatch', () => {
		const dispatch = vi.fn();
		const focus = vi.fn();
		dispatchAndRestoreFocus({ hasFocus: true, dispatch, focus }, {});
		expect(dispatch).toHaveBeenCalledOnce();
		expect(focus).toHaveBeenCalledOnce();
	});

	it('does not summon focus for a toolbar click from outside the editor', () => {
		const dispatch = vi.fn();
		const focus = vi.fn();
		dispatchAndRestoreFocus({ hasFocus: false, dispatch, focus }, {});
		expect(dispatch).toHaveBeenCalledOnce();
		expect(focus).not.toHaveBeenCalled();
	});

	it('recognizes Shift-select as note-wide selection', () => {
		expect(isNoteWideSelection({ shiftKey: true })).toBe(true);
		expect(isNoteWideSelection({ shiftKey: false })).toBe(false);
	});
});
