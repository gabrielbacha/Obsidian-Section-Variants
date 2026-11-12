import {ResolvedBlockState} from '../core/state-model';
import {
	Component,
	MarkdownRenderChild,
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
import { findReboundBlock } from '../reading/rebind';
import { createBlockControls } from './block-controls';
import { visibleColumnWidths } from '../core/column-ratios';
import { syncColumnGrid, syncColumnSeparators } from './column-layout';
import { createVariantHeader, VariantHeaderHandle } from './variant-header';
import { renderNativePreview } from './native-preview';
import { applyPreviewEdit } from './preview-edit';

export class VariantBlockRenderer extends MarkdownRenderChild {
	private renderComponent?: Component;
	private unsubscribe?: () => void;
	private resizeObserver?: ResizeObserver;
	private renderVersion = 0;
	private columnsContent?: HTMLElement;
	private columnWidths?: string;
	private columnResponsive = 'responsive';
	private visibleColumnCount = 0;
	private readonly headers = new Map<string, VariantHeaderHandle>();
	private readonly nestedRenderers: VariantBlockRenderer[] = [];
	private controls?: { rebind(block: VariantBlock): void };
	private deferredRender = false;
	private disposed=false;
	private renderedSource?:string;
	private content?:HTMLElement;
	private emptyMessage?:HTMLElement;
	private readonly panels=new Map<string,HTMLElement>();

	constructor(
		private readonly host: SectionVariantsHost,
		containerEl: HTMLElement,
		private readonly sourcePath: string,
		private source: string,
		private block: VariantBlock,
		private readonly onDispose?: () => void,
	) {
		super(containerEl);
	}

	onload(): void {
		this.disposed=false;
		this.unsubscribe = this.host.store.subscribe((change) => {
			if (change.scope === 'settings') this.requestRender();
			else if (
				change.path === this.sourcePath &&
				(change.scope === 'note' || change.blockKey === this.block.identityKey)
			) {
				this.requestRender();
			}
		});
		this.resizeObserver = new ResizeObserver(() => {
			if (this.columnsContent) {
				syncColumnGrid(
					this.columnsContent,
					this.columnWidths,
					this.columnResponsive,
					this.visibleColumnCount,
				);
				syncColumnSeparators(this.columnsContent);
			}
		});
		this.resizeObserver.observe(this.containerEl);
		this.requestRender();
	}

	onunload(): void {
		this.disposed=true;this.renderVersion++;
		this.unsubscribe?.();
		this.resizeObserver?.disconnect();
		this.clearRenderComponent();
		this.containerEl.empty();
		this.onDispose?.();
	}

	rebind(source: string, blocks: readonly VariantBlock[], preserveEditor = false): void {
		const previousBlocks = this.host.parse(this.source).blocks;
		const next = findReboundBlock(previousBlocks, this.block, blocks);
		if (!next) return;
		const unchanged = this.source.slice(this.block.range.from, this.block.range.to) === source.slice(next.range.from, next.range.to);
		this.source = source;
		this.block = next;
		const editing = preserveEditor && Boolean(this.containerEl.querySelector('.section-variants-column-editor'));
		if ((!unchanged || this.deferredRender) && !editing) {
			this.deferredRender = false;
			this.requestRender();
			return;
		}
		if (!unchanged) this.deferredRender = true;
		this.containerEl.dataset.blockKey = next.identityKey;
		this.controls?.rebind(next);
		for (const variant of next.variants) {
			const header = this.headers.get(variant.normalizedLabel);
			header?.rebind(source, variant);
			if (header?.element.parentElement) header.element.parentElement.dataset.blockFrom = String(next.opening.from);
		}
		for (const renderer of this.nestedRenderers) renderer.rebind(source, blocks, preserveEditor);
	}

	private requestRender():void{void this.render().catch(error=>{if(!this.disposed)new Notice(error instanceof Error?error.message:'Section Variants rendering failed.');});}

	private async render(): Promise<void> {
		if(this.disposed)return;
		const signature=String(this.block.valid)+this.source.slice(this.block.range.from,this.block.range.to);
		if(this.renderedSource===signature&&this.content&&this.renderComponent){this.updateState(this.host.store.resolve(this.sourcePath,this.block));return;}
		const version = ++this.renderVersion;
		this.clearRenderComponent();
		this.containerEl.empty();
		this.containerEl.addClass('section-variants-root');
		this.containerEl.toggleClass(
			'has-block-name',
			Boolean(this.block.attributes.name),
		);
		this.containerEl.dataset.blockKey = this.block.identityKey;
		this.containerEl.dataset.authoredView = effectiveAuthoredView(
			this.block,
			this.host.store.settings.defaultView,
		);

		if(!this.block.valid){this.containerEl.createDiv({cls:'section-variants-warning',text:this.block.diagnostics.find(diagnostic=>diagnostic.severity==='error')?.message??'Invalid variants block; all source remains visible.'});this.containerEl.createEl('pre').createEl('code',{text:this.source.slice(this.block.range.from,this.block.range.to)});return;}
		this.renderedSource=signature;
		const component = new Component();
		this.renderComponent = this.addChild(component);
		const state = this.host.store.resolve(this.sourcePath, this.block);
		const mode = state.view;
		this.renderToolbar(mode);
		this.containerEl.dataset.currentView = mode;
		const content = this.containerEl.createDiv({
			cls: `section-variants-content section-variants-view-${mode}${this.block.attributes.name ? ' has-block-name' : ''}`,
		});
		this.content=content;
		if (this.block.attributes.name) {
			content.createDiv({
				cls: 'section-variants-block-name',
				text: this.block.attributes.name,
			});
		}
		this.columnsContent = mode === 'columns' ? content : undefined;
		content.dataset.responsive = state.responsive;
		content.style.setProperty('--section-variants-min-width', state.minWidth);
		if (mode === 'columns') {
			this.columnWidths = visibleColumnWidths(
				state.widths,
				this.block.variants.length,
				this.block.variants.flatMap((variant, index) =>
					state.hiddenLabels.has(variant.normalizedLabel) ? [] : [index],
				),
			);
			this.columnResponsive = state.responsive;
		}

		const variants = this.block.variants;
		let visibleCount = 0;

		for (const variant of variants) {
			if (this.disposed || version !== this.renderVersion) return;
			const panel = content.createDiv({ cls: 'section-variants-panel' });
			panel.dataset.label = variant.label;
			this.panels.set(variant.normalizedLabel,panel);
			panel.dataset.blockFrom = String(this.block.opening.from);
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
			this.headers.set(variant.normalizedLabel, createVariantHeader({
				parent: panel,
				source: this.source,
				variant,
				onHide:()=>this.host.store.toggleHidden(this.sourcePath,this.block,variant.label),
			}));
			this.headers.get(variant.normalizedLabel)?.setHideVisible(mode==='columns');
			const body = panel.createDiv({ cls: 'section-variants-prose' });
			await this.renderVariantContent(variant, body, component,version);
			if(this.disposed||version!==this.renderVersion)return;
		}

		if (visibleCount === 0) {
			const empty = content.createDiv({ cls: 'section-variants-empty' });
			this.emptyMessage=empty;
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
		if (mode === 'columns') {
			this.visibleColumnCount = visibleCount;
			syncColumnGrid(content, this.columnWidths, state.responsive, visibleCount);
			syncColumnSeparators(content);
		}
		this.updateState(this.host.store.resolve(this.sourcePath,this.block));
	}

	private updateState(state:ResolvedBlockState):void{
		if(this.disposed||!this.content)return;
		const mode=state.view,content=this.content;
		this.containerEl.querySelector(':scope > .section-variants-toolbar')?.remove();this.renderToolbar(mode);
		this.containerEl.dataset.currentView=mode;
		content.toggleClass('section-variants-view-columns',mode==='columns');content.toggleClass('section-variants-view-toggle',mode==='toggle');
		content.dataset.responsive=state.responsive;content.style.setProperty('--section-variants-min-width',state.minWidth);
		let count=0;
		for(const variant of this.block.variants){const panel=this.panels.get(variant.normalizedLabel);if(!panel)continue;const selected=variant.normalizedLabel===normalizeLabel(state.selectedLabel),hidden=state.hiddenLabels.has(variant.normalizedLabel);panel.toggleClass('is-inactive',mode==='toggle'&&!selected);panel.toggleClass('is-hidden-column',mode==='columns'&&hidden);this.headers.get(variant.normalizedLabel)?.setHideVisible(mode==='columns');if(mode==='toggle'?selected:!hidden)count++;}
		this.columnsContent=mode==='columns'?content:undefined;this.visibleColumnCount=count;this.columnResponsive=state.responsive;
		this.columnWidths=visibleColumnWidths(state.widths,this.block.variants.length,this.block.variants.flatMap((variant,index)=>state.hiddenLabels.has(variant.normalizedLabel)?[]:[index]));
		if(mode==='columns'){syncColumnGrid(content,this.columnWidths,state.responsive,count);syncColumnSeparators(content);}
		if(count>0){this.emptyMessage?.remove();this.emptyMessage=undefined;}else if(!this.emptyMessage){const empty=content.createDiv({cls:'section-variants-empty',text:'All columns are hidden.'});const restore=empty.createEl('button',{type:'button',text:'Restore columns'});restore.addEventListener('click',()=>this.host.store.restoreColumns(this.sourcePath,this.block));this.emptyMessage=empty;}
	}

	private renderToolbar(mode: 'toggle' | 'columns'): void {
		const toolbar = this.containerEl.createDiv({ cls: 'section-variants-toolbar' });
		this.content?.before(toolbar);
		toolbar.setAttribute('role', 'toolbar');
		toolbar.setAttribute('aria-label', 'Section variants');
		this.controls = createBlockControls({
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
		version:number,
	): Promise<void> {
		let cursor = variant.content.from;
		let index = 0;
		const children = [...variant.children].sort(
			(left, right) => left.range.from - right.range.from,
		);
		for (const child of children) {
			if(this.disposed||version!==this.renderVersion)return;
			if (child.range.from > cursor) {
				await this.renderMarkdown(
					this.source.slice(cursor, child.range.from),
					target,
					component,
					variant.normalizedLabel,
					index,
				);
			}
			if(this.disposed||version!==this.renderVersion)return;
			const nested = target.createDiv({ cls: 'section-variants-nested' });
			const renderer = new VariantBlockRenderer(
				this.host,
				nested,
				this.sourcePath,
				this.source,
				child,
			);
			component.addChild(renderer);
			this.nestedRenderers.push(renderer);
			cursor = child.range.to;
			index++;
		}
		if (cursor < variant.content.to) {
			await this.renderMarkdown(
				this.source.slice(cursor, variant.content.to),
				target,
				component,
				variant.normalizedLabel,
				index,
			);
		}
	}

	private async renderMarkdown(
		markdown: string,
		target: HTMLElement,
		component: Component,
		label: string,
		index: number,
	): Promise<void> {
		if (!markdown.trim()) return;
		await renderNativePreview(
			this.host.app,
			markdown,
			target,
			this.sourcePath,
			component,
			(before, after) => applyPreviewEdit(this.host, this.sourcePath, this.block, label, index, before, after, target),
		);
	}

	private clearRenderComponent(): void {
		this.renderedSource=undefined;this.content=undefined;this.emptyMessage=undefined;this.panels.clear();
		this.headers.clear();
		this.nestedRenderers.length = 0;
		this.controls = undefined;
		this.columnsContent = undefined;
		this.columnWidths = undefined;
		this.columnResponsive = 'responsive';
		this.visibleColumnCount = 0;
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
