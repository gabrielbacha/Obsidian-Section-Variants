import { Notice, setIcon, setTooltip } from 'obsidian';
import { VariantSection } from '../core/types';

export interface VariantHeaderOptions {
	parent: HTMLElement;
	source: string;
	variant: VariantSection;
	onHide?: () => void;
}

export interface VariantHeaderHandle {
	element: HTMLElement;
	rebind(source: string, variant: VariantSection): void;
}

/** Exact Markdown inside the variant, excluding only its own fences. */
export function variantClipboardText(
	source: string,
	variant: VariantSection,
): string {
	return source.slice(variant.content.from, variant.content.to);
}

export function createVariantHeader({
	parent,
	source,
	variant: initialVariant,
	onHide,
}: VariantHeaderOptions): VariantHeaderHandle {
	let currentSource = source;
	let currentVariant = initialVariant;
	const header = parent.createDiv({ cls: 'section-variants-column-header' });
	header.createSpan({ text: initialVariant.label });
	const actions = header.createDiv({ cls: 'section-variants-column-actions' });
	const copy = actions.createEl('button', {
		type: 'button',
		cls: 'clickable-icon',
		attr: { 'aria-label': `Copy ${initialVariant.label} contents` },
	});
	setIcon(copy, 'copy');
	setTooltip(copy, `Copy ${initialVariant.label} contents`);
	copy.addEventListener('click', () => {
		void copyVariantContents(
			currentSource,
			currentVariant,
			parent.ownerDocument,
		);
	});
	if (onHide) {
		const hide = actions.createEl('button', {
			type: 'button',
			cls: 'clickable-icon',
			attr: { 'aria-label': `Hide ${initialVariant.label} column` },
		});
		setIcon(hide, 'eye-off');
		setTooltip(hide, `Hide ${initialVariant.label} column`);
		hide.addEventListener('click', onHide);
	}
	return {
		element: header,
		rebind(nextSource, nextVariant) {
			currentSource = nextSource;
			currentVariant = nextVariant;
		},
	};
}

async function copyVariantContents(
	source: string,
	variant: VariantSection,
	ownerDocument: Document,
): Promise<void> {
	const clipboard = ownerDocument.defaultView?.navigator.clipboard;
	if (!clipboard) {
		new Notice('Clipboard access is unavailable.');
		return;
	}
	try {
		await clipboard.writeText(variantClipboardText(source, variant));
		new Notice(`Copied ${variant.label}.`);
	} catch {
		new Notice(`Could not copy ${variant.label}.`);
	}
}
