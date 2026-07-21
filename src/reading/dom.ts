/** Create Reading View DOM through its owning document, including pop-outs. */
export function createOwnerDocumentMount(root: HTMLElement): HTMLDivElement {
	return ownerWindow(root).createDiv();
}

export function createOwnerDocumentElement<K extends keyof HTMLElementTagNameMap>(
	root: HTMLElement,
	tag: K,
): HTMLElementTagNameMap[K] {
	return ownerWindow(root).createEl(tag);
}

export function createOwnerDocumentRange(
	root: HTMLElement,
	opening: HTMLElement,
	closing: HTMLElement,
): Range {
	const range = root.ownerDocument.createRange();
	range.setStartBefore(opening);
	range.setEndAfter(closing);
	return range;
}

type ObsidianWindow = Window & {
	createDiv(): HTMLDivElement;
	createEl<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
};

function ownerWindow(root: HTMLElement): ObsidianWindow {
	return root.ownerDocument.win as ObsidianWindow;
}
