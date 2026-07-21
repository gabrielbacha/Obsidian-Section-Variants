import {
	Component,
	MarkdownRenderChild,
	MarkdownRenderer,
	Notice,
	setIcon,
} from 'obsidian';
import {
	effectiveAuthoredLabel,
	effectiveAuthoredView,
	normalizeLabel,
	VariantBlock,
	VariantSection,
} from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { createBlockControls } from './block-controls';
import { syncColumnSeparators } from './column-layout';
import { hasRoomForColumns, resolveLengthPx } from './css-length';
import { createVariantHeader } from './variant-header';

export class VariantBlockRenderer extends MarkdownRenderChild {
	private renderComponent?: Component;
	private unsubscribe?: () => void;
	private resizeObserver?: ResizeObserver;
	private autoColumns = false;
	private renderVersion = 0;
	private columnsContent?: HTMLElement;

	constructor(
		private readonly host: SectionVariantsHost,
		containerEl: HTMLElement,
		private readonly sourcePath: string,
		private readonly source: string,
		private readonly block: VariantBlock,
	) {
		super(containerEl);
	}

	onload(): void {
		this.unsubscribe = this.host.store.subscribe((change) => {
			if (change.scope === 'settings') void this.render();
			else if (
				change.path === this.sourcePath &&
				(change.scope === 'note' || change.blockKey === this.block.identityKey)
			) {
				void this.render();
			}
		});
		this.resizeObserver = new ResizeObserver(() => {
			const next = this.hasRoomForColumns();
			if (next === this.autoColumns) {
				if (this.columnsContent) syncColumnSeparators(this.columnsContent);
				return;
			}
			this.autoColumns = next;
			void this.render();
		});
		this.resizeObserver.observe(this.containerEl);
		this.autoColumns = this.hasRoomForColumns();
		void this.render();
	}

	onunload(): void {
		this.unsubscribe?.();
		this.resizeObserver?.disconnect();
		this.clearRenderComponent();
	}

	private async render(): Promise<void> {
		const version = ++this.renderVersion;
		this.clearRenderComponent();
		this.containerEl.empty();
		this.containerEl.addClass('section-variants-root');
		this.containerEl.dataset.blockKey = this.block.identityKey;
		this.containerEl.dataset.authoredView = effectiveAuthoredView(
			this.block,
			this.host.store.settings.defaultView,
		);

		const component = new Component();
		this.renderComponent = this.addChild(component);
		const state = this.host.store.resolve(this.sourcePath, this.block);
		const mode = state.view === 'auto' ? (this.autoColumns ? 'columns' : 'toggle') : state.view;
		this.renderToolbar(mode);
		this.containerEl.dataset.currentView = mode;
		const content = this.containerEl.createDiv({
			cls: `section-variants-content section-variants-view-${mode}`,
		});
		if (this.block.attributes.name) {
			content.createDiv({
				cls: 'section-variants-block-name',
				text: this.block.attributes.name,
			});
		}
		this.columnsContent = mode === 'columns' ? content : undefined;
		content.dataset.responsive = state.responsive;
		content.style.setProperty('--section-variants-min-width', state.minWidth);
		if (mode === 'columns') this.configureColumns(content, state.widths, state.responsive);

		const variants = this.block.variants;
		let visibleCount = 0;

		for (const variant of variants) {
			if (version !== this.renderVersion) return;
			const panel = content.createDiv({ cls: 'section-variants-panel' });
			panel.dataset.label = variant.label;
			const selected =
				variant.normalizedLabel === normalizeLabel(state.selectedLabel);
			const hiddenColumn = state.hiddenLabels.has(variant.normalizedLabel);
			panel.toggleClass('is-inactive', mode === 'toggle' && !selected);
			panel.toggleClass(
				'is-hidden-column',
				mode === 'columns' && hiddenColumn,
			);
			if ((mode === 'toggle' && selected) || (mode === 'columns' && !hiddenColumn)) {
				visibleCount += 1;
			}
			panel.dataset.authoredDefault = String(
				variant.normalizedLabel === normalizeLabel(effectiveAuthoredLabel(this.block)),
			);
			createVariantHeader({
				parent: panel,
				source: this.source,
				variant,
				onHide:
					mode === 'columns'
						? () => {
								this.host.store.toggleHidden(
									this.sourcePath,
									this.block,
									variant.label,
								);
							}
						: undefined,
			});
			await this.renderVariantContent(variant, panel, component);
		}

		if (visibleCount === 0) {
			const empty = content.createDiv({ cls: 'section-variants-empty' });
			setIcon(empty.createSpan(), 'layers');
			empty.createSpan({ text: 'All columns are hidden.' });
			const restore = empty.createEl('button', {
				type: 'button',
				text: 'Restore columns',
			});
			restore.addEventListener('click', () => {
				this.host.store.restoreColumns(this.sourcePath, this.block);
			});
		}
		if (mode === 'columns') syncColumnSeparators(content);
	}

	private renderToolbar(mode: 'toggle' | 'columns'): void {
		const toolbar = this.containerEl.createDiv({ cls: 'section-variants-toolbar' });
		toolbar.setAttribute('role', 'toolbar');
		toolbar.setAttribute('aria-label', 'Section variants');
		createBlockControls({
			host: this.host,
			path: this.sourcePath,
			block: this.block,
			parent: toolbar,
			mode,
			onSelectLabel: (label, event) => {
				if (event.shiftKey) {
					const parsed = this.host.parse(this.source);
					const result = this.host.store.applyLabelAcrossNote(
						this.sourcePath,
						parsed,
						label,
					);
					new Notice(
						`Applied to ${result.applied} block${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}.`,
					);
				} else {
					void this.selectLocalVariant(label);
				}
			},
		});
	}

	private async renderVariantContent(
		variant: VariantSection,
		target: HTMLElement,
		component: Component,
	): Promise<void> {
		let cursor = variant.content.from;
		const children = [...variant.children].sort(
			(left, right) => left.range.from - right.range.from,
		);
		for (const child of children) {
			if (child.range.from > cursor) {
				await this.renderMarkdown(
					this.source.slice(cursor, child.range.from),
					target,
					component,
				);
			}
			const nested = target.createDiv({ cls: 'section-variants-nested' });
			const renderer = new VariantBlockRenderer(
				this.host,
				nested,
				this.sourcePath,
				this.source,
				child,
			);
			component.addChild(renderer);
			cursor = child.range.to;
		}
		if (cursor < variant.content.to) {
			await this.renderMarkdown(
				this.source.slice(cursor, variant.content.to),
				target,
				component,
			);
		}
	}

	private async renderMarkdown(
		markdown: string,
		target: HTMLElement,
		component: Component,
	): Promise<void> {
		if (!markdown.trim()) return;
		await MarkdownRenderer.render(
			this.host.app,
			markdown,
			target,
			this.sourcePath,
			component,
		);
	}

	private configureColumns(
		content: HTMLElement,
		widths: string | undefined,
		responsive: string,
	): void {
		if (
			widths &&
			!/[;{}]/u.test(widths) &&
			window.CSS?.supports('grid-template-columns', widths)
		) {
			content.style.gridTemplateColumns = widths;
		}
		content.toggleClass('section-variants-columns-stack', responsive === 'stack');
		content.toggleClass('section-variants-columns-scroll', responsive === 'scroll');
	}

	private hasRoomForColumns(): boolean {
		const minWidth = resolveLengthPx(
			this.block.attributes.minWidth ??
				this.host.store.settings.defaultMinWidth,
			this.containerEl,
		);
		return hasRoomForColumns(
			this.containerEl.clientWidth,
			minWidth,
			this.block.variants.length,
		);
	}

	private clearRenderComponent(): void {
		this.columnsContent = undefined;
		if (!this.renderComponent) return;
		this.removeChild(this.renderComponent);
		this.renderComponent = undefined;
	}

	private async selectLocalVariant(label: string): Promise<void> {
		const persistent = await this.host.ensurePersistentIdentity(
			this.sourcePath,
			this.block,
		);
		if (!persistent) return;
		this.host.store.setSelectedLabel(this.sourcePath, persistent, label);
	}
}
