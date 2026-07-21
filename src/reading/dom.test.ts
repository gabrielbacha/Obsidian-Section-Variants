import { describe, expect, it, vi } from 'vitest';
import { createOwnerDocumentMount, createOwnerDocumentRange } from './dom';

describe('Reading View owner-document DOM', () => {
	it('creates mounts and ranges from the rendered root document', () => {
		const mount = {};
		const range = {
			setStartBefore: vi.fn(),
			setEndAfter: vi.fn(),
		};
		const ownerDocument = {
			win: { createDiv: vi.fn(() => mount), createEl: vi.fn(() => mount) },
			createRange: vi.fn(() => range),
		};
		const root = { ownerDocument } as unknown as HTMLElement;
		const opening = {} as HTMLElement;
		const closing = {} as HTMLElement;

		expect(createOwnerDocumentMount(root)).toBe(mount);
		expect(createOwnerDocumentRange(root, opening, closing)).toBe(range);
		expect(ownerDocument.win.createDiv).toHaveBeenCalledOnce();
		expect(range.setStartBefore).toHaveBeenCalledWith(opening);
		expect(range.setEndAfter).toHaveBeenCalledWith(closing);
	});
});
