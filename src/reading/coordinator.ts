import {
	MarkdownPostProcessorContext,
	Notice,
	setIcon,
	TFile,
} from 'obsidian';
import { FenceToken, VariantBlock } from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { VariantBlockRenderer } from '../ui/block-renderer';

export class ReadingViewCoordinator {
	private readonly scheduledRoots = new WeakSet<HTMLElement>();

	constructor(private readonly host: SectionVariantsHost) {}

	postProcess(el: HTMLElement, context: MarkdownPostProcessorContext): void {
		if (el.closest('.section-variants-root')) return;
		const root = el.closest<HTMLElement>('.markdown-preview-view') ?? el;
		if (this.scheduledRoots.has(root)) return;
		this.scheduledRoots.add(root);
		window.setTimeout(() => {
			this.scheduledRoots.delete(root);
			void this.processRoot(root, context);
		}, 0);
	}

	private async processRoot(
		root: HTMLElement,
		context: MarkdownPostProcessorContext,
	): Promise<void> {
		const file = this.host.app.vault.getAbstractFileByPath(context.sourcePath);
		if (!(file instanceof TFile)) return;
		const source = await this.host.app.vault.cachedRead(file);
		const sourceHash = quickHash(source);
		if (root.dataset.sectionVariantsSourceHash === sourceHash) return;

		const parsed = this.host.parse(source);
		if (parsed.blocks.length === 0) return;
		const fenceElements = collectFenceElements(root);
		const mapped = mapFencesToElements(parsed.fences, fenceElements);

		for (const block of parsed.roots) {
			const opening = mapped.get(block.opening);
			if (!opening) continue;
			if (!block.valid || !block.closing) {
				this.renderWarning(opening, context.sourcePath, block);
				continue;
			}
			const closing = mapped.get(block.closing);
			if (!closing || !safeOrderedRange(root, opening, closing)) {
				this.renderMappingWarning(opening);
				continue;
			}

			const mount = createDiv();
			mount.addClass('section-variants-mount');
			opening.before(mount);
			const range = document.createRange();
			range.setStartBefore(opening);
			range.setEndAfter(closing);
			try {
				range.deleteContents();
			} catch {
				mount.remove();
				this.renderMappingWarning(opening);
				continue;
			}

			const renderer = new VariantBlockRenderer(
				this.host,
				mount,
				context.sourcePath,
				source,
				block,
			);
			context.addChild(renderer);
		}
		root.dataset.sectionVariantsSourceHash = sourceHash;
	}

	private renderWarning(
		opening: HTMLElement,
		path: string,
		block: VariantBlock,
	): void {
		if (opening.parentElement?.querySelector('.section-variants-warning')) return;
		const diagnostic = block.diagnostics.find(
			(item) => item.severity === 'error',
		);
		const warning = createEl('button');
		warning.type = 'button';
		warning.addClass('clickable-icon', 'section-variants-warning');
		warning.setAttribute(
			'aria-label',
			diagnostic?.message ?? 'Malformed variants block',
		);
		warning.title = diagnostic
			? `Line ${diagnostic.line + 1}: ${diagnostic.message}`
			: 'Malformed variants block';
		setIcon(warning, 'triangle-alert');
		warning.addEventListener('click', () => {
			if (diagnostic?.fix === 'append-closer') {
				void this.host.fixBlock(path, block);
			} else {
				new Notice(warning.title);
			}
		});
		opening.after(warning);
	}

	private renderMappingWarning(opening: HTMLElement): void {
		if (opening.parentElement?.querySelector('.section-variants-warning')) return;
		const warning = createSpan();
		warning.addClass('section-variants-warning');
		warning.setAttribute('role', 'img');
		warning.setAttribute(
			'aria-label',
			'Variants block could not be mapped safely; all content remains visible.',
		);
		warning.title =
			'Variants block could not be mapped safely; all content remains visible.';
		setIcon(warning, 'triangle-alert');
		opening.after(warning);
	}
}

function collectFenceElements(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>('p')).filter((element) => {
		if (element.closest('pre, code, .section-variants-root')) return false;
		return /^:{3,}(?:\s+.+)?$/u.test(element.textContent?.trim() ?? '');
	});
}

function mapFencesToElements(
	fences: FenceToken[],
	elements: HTMLElement[],
): Map<FenceToken, HTMLElement> {
	const mapped = new Map<FenceToken, HTMLElement>();
	let elementIndex = 0;
	for (const fence of fences) {
		while (elementIndex < elements.length) {
			const element = elements[elementIndex];
			elementIndex += 1;
			if (element?.textContent?.trim() !== fence.text) continue;
			mapped.set(fence, element);
			break;
		}
	}
	return mapped;
}

function safeOrderedRange(
	root: HTMLElement,
	opening: HTMLElement,
	closing: HTMLElement,
): boolean {
	if (!root.contains(opening) || !root.contains(closing)) return false;
	const relation = opening.compareDocumentPosition(closing);
	return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
}

function quickHash(source: string): string {
	let hash = 5381;
	for (let index = 0; index < source.length; index += 1) {
		hash = (hash * 33) ^ source.charCodeAt(index);
	}
	return `${source.length}:${hash >>> 0}`;
}
