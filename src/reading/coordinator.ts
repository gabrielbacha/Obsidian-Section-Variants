import {
	MarkdownPostProcessorContext,
	Notice,
	setIcon,
	TFile,
} from 'obsidian';
import { FenceToken, VariantBlock } from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { VariantBlockRenderer } from '../ui/block-renderer';
import {
	mapSectionFenceTexts,
	SectionLineRange,
} from './section-mapping';
import {
	createOwnerDocumentElement,
	createOwnerDocumentMount,
	createOwnerDocumentRange,
} from './dom';

interface PendingSection extends SectionLineRange {
	element: HTMLElement;
	context: MarkdownPostProcessorContext;
}

interface MappedFence {
	element: HTMLElement;
	context: MarkdownPostProcessorContext;
}

interface RootState {
	source: string;
	sections: PendingSection[];
	mapped: Map<FenceToken, MappedFence>;
	ambiguous: Set<FenceToken>;
}

export class ReadingViewCoordinator {
	private readonly scheduledRoots = new WeakSet<HTMLElement>();
	private readonly rootStates = new WeakMap<HTMLElement, RootState>();
	private readonly processedOpenings = new WeakSet<HTMLElement>();
	private readonly renderers = new Map<string, Set<VariantBlockRenderer>>();

	constructor(private readonly host: SectionVariantsHost) {}

	rebind(path: string, source: string): void {
		const renderers = this.renderers.get(path);
		if (!renderers) return;
		const blocks = this.host.parse(source).blocks;
		for (const renderer of renderers) renderer.rebind(source, blocks);
	}

	postProcess(el: HTMLElement, context: MarkdownPostProcessorContext): void {
		if (el.closest('.section-variants-root')) return;
		const root = el.closest<HTMLElement>('.markdown-preview-view') ?? el;
		const info = context.getSectionInfo(el);
		if (!info) return;
		const current = this.rootStates.get(root);
		const section: PendingSection = {
			element: el,
			context,
			lineStart: info.lineStart,
			lineEnd: info.lineEnd,
		};
		if (current && !current.sections.some((entry) => entry.element === el)) {
			current.sections.push(section);
		} else if (!current) {
			this.rootStates.set(root, {
				source: '',
				sections: [section],
				mapped: new Map(),
				ambiguous: new Set(),
			});
		}
		this.schedule(root, context.sourcePath);
	}

	private schedule(root: HTMLElement, sourcePath: string): void {
		if (this.scheduledRoots.has(root)) return;
		this.scheduledRoots.add(root);
		window.setTimeout(() => {
			this.scheduledRoots.delete(root);
			void this.processRoot(root, sourcePath);
		}, 0);
	}

	private async processRoot(root: HTMLElement, sourcePath: string): Promise<void> {
		const file = this.host.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) return;
		const source = await this.host.app.vault.cachedRead(file);
		const parsed = this.host.parse(source);
		const state = this.rootStates.get(root);
		if (!state || parsed.blocks.length === 0) return;
		if (state.source !== source) {
			state.source = source;
			state.mapped.clear();
			state.ambiguous.clear();
		}
		state.sections = state.sections.filter((section) => section.element.isConnected);

		for (const section of state.sections) {
			const elements = collectFenceElements(section.element);
			const texts = elements.map((element) => element.textContent?.trim() ?? '');
			const fences = mapSectionFenceTexts(parsed.fences, section, texts);
			if (!fences) {
				if (elements[0]) this.renderMappingWarning(elements[0]);
				continue;
			}
			fences.forEach((fence, index) => {
				const element = elements[index];
				if (!element) return;
				const prior = state.mapped.get(fence);
				if (prior && prior.element !== element) {
					state.ambiguous.add(fence);
					state.mapped.delete(fence);
					this.renderMappingWarning(prior.element);
					this.renderMappingWarning(element);
					return;
				}
				state.mapped.set(fence, { element, context: section.context });
			});
		}

		const latestCapturedLine = Math.max(
			-1,
			...state.sections.map((section) => section.lineEnd),
		);
		for (const block of parsed.roots) {
			const opening = state.mapped.get(block.opening);
			if (!opening || this.processedOpenings.has(opening.element)) continue;
			if (!block.valid || !block.closing) {
				this.renderWarning(opening.element, sourcePath, block);
				continue;
			}
			const closing = state.mapped.get(block.closing);
			const ambiguous =
				state.ambiguous.has(block.opening) || state.ambiguous.has(block.closing);
			if (
				ambiguous ||
				(!closing && block.closing.lineStart <= latestCapturedLine)
			) {
				this.renderMappingWarning(opening.element);
				continue;
			}
			if (!closing) continue; // A later render chunk may contain the boundary.
			if (!safeOrderedRange(root, opening.element, closing.element)) {
				this.renderMappingWarning(opening.element);
				continue;
			}

			const mount = createOwnerDocumentMount(root);
			mount.addClass('section-variants-mount');
			opening.element.before(mount);
			const range = createOwnerDocumentRange(
				root,
				opening.element,
				closing.element,
			);
			try {
				range.deleteContents();
			} catch {
				mount.remove();
				this.renderMappingWarning(opening.element);
				continue;
			}
			this.processedOpenings.add(opening.element);
			let renderer: VariantBlockRenderer;
			renderer = new VariantBlockRenderer(
				this.host,
				mount,
				sourcePath,
				source,
				block,
				() => this.untrackRenderer(sourcePath, renderer),
			);
			this.trackRenderer(sourcePath, renderer);
			opening.context.addChild(renderer);
		}
	}

	private trackRenderer(path: string, renderer: VariantBlockRenderer): void {
		let renderers = this.renderers.get(path);
		if (!renderers) {
			renderers = new Set();
			this.renderers.set(path, renderers);
		}
		renderers.add(renderer);
	}

	private untrackRenderer(path: string, renderer: VariantBlockRenderer): void {
		const renderers = this.renderers.get(path);
		if (!renderers) return;
		renderers.delete(renderer);
		if (renderers.size === 0) this.renderers.delete(path);
	}

	private renderWarning(
		opening: HTMLElement,
		path: string,
		block: VariantBlock,
	): void {
		if (opening.parentElement?.querySelector('.section-variants-warning')) return;
		const diagnostic = block.diagnostics.find((item) => item.severity === 'error');
		const warning = createOwnerDocumentElement(opening, 'button');
		warning.type = 'button';
		warning.addClass('clickable-icon', 'section-variants-warning');
		warning.setAttribute('aria-label', diagnostic?.message ?? 'Malformed variants block');
		warning.title = diagnostic
			? `Line ${diagnostic.line + 1}: ${diagnostic.message}`
			: 'Malformed variants block';
		setIcon(warning, 'triangle-alert');
		warning.addEventListener('click', () => {
			if (diagnostic?.fix === 'append-closer') void this.host.fixBlock(path, block);
			else new Notice(warning.title);
		});
		opening.after(warning);
	}

	private renderMappingWarning(opening: HTMLElement): void {
		if (opening.parentElement?.querySelector('.section-variants-warning')) return;
		const warning = createOwnerDocumentElement(opening, 'span');
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
	const candidates = root.matches('p')
		? [root]
		: Array.from(root.querySelectorAll<HTMLElement>('p'));
	return candidates.filter((element) => {
		if (element.closest('pre, code, .section-variants-root')) return false;
		return /^:{3,}(?:\s+.+)?$/u.test(element.textContent?.trim() ?? '');
	});
}

function safeOrderedRange(
	root: HTMLElement,
	opening: HTMLElement,
	closing: HTMLElement,
): boolean {
	if (!root.contains(opening) || !root.contains(closing)) return false;
	const relation = opening.compareDocumentPosition(closing);
	const following =
		root.ownerDocument.defaultView?.Node.DOCUMENT_POSITION_FOLLOWING ?? 4;
	return Boolean(relation & following);
}
