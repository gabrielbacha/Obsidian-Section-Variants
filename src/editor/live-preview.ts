import {
	EditorState,
	Extension,
	Prec,
	Range,
	StateEffect,
	StateField,
	Transaction,
} from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	keymap,
	PluginValue,
	ViewPlugin,
	WidgetType,
} from '@codemirror/view';
import {
	Component,
	editorInfoField,
	editorLivePreviewField,
	Notice,
	setIcon,
} from 'obsidian';
import { VariantBlock, VariantSection } from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { createBlockControls } from '../ui/block-controls';
import { syncColumnSeparators } from '../ui/column-layout';
import { hasRoomForColumns, resolveLengthPx } from '../ui/css-length';
import {
	createVariantHeader,
	VariantHeaderHandle,
} from '../ui/variant-header';
import {
	changesAreWithinEditableSpans,
	DocumentChange,
	EditableSpan,
	editableSpansForVariant,
} from './edit-boundaries';
import { blockSpan } from './ranges';
import { isNoteWideSelection } from './interactions';
import { InlineColumnEditor } from './inline-column-editor';
import { liveEditableVariants } from './live-variants';
import { widgetPositionIdentity } from './widget-identity';

const refreshEffect = StateEffect.define<void>();
const refreshField = StateField.define<number>({
	create: () => 0,
	update(value, transaction) {
		return transaction.effects.some((effect) => effect.is(refreshEffect))
			? value + 1
			: value;
	},
});
const editorWidthEffect = StateEffect.define<number>();
const editorWidthField = StateField.define<number>({
	create: () => 0,
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(editorWidthEffect)) return effect.value;
		}
		return value;
	},
});

const editorViews = new Set<EditorView>();

/**
 * Ask live-preview editors to rebuild. Pass a path to limit the work to editors
 * showing that file; without one, every open editor rebuilds.
 */
export function refreshLivePreviewEditors(path?: string): void {
	for (const view of editorViews) {
		if (path !== undefined) {
			const info = view.state.field(editorInfoField, false);
			if (info?.file?.path !== path) continue;
		}
		view.dispatch({ effects: refreshEffect.of() });
	}
}

export function createLivePreviewExtension(
	host: SectionVariantsHost,
): Extension {
	interface VariantDecorations {
		deco: DecorationSet;
		atomic: DecorationSet;
	}
	const decorationsField = StateField.define<VariantDecorations>({
		create(state) {
			return buildDecorations(host, state);
		},
		update(decorations, transaction) {
			/*
			 * Decorations depend on the document, the editor width, and store
			 * state — never on the selection. Rebuilding on every cursor move
			 * re-parsed the whole document for nothing, so only these three
			 * trigger a rebuild.
			 */
			const relevantEffect = transaction.effects.some(
				(effect) => effect.is(refreshEffect) || effect.is(editorWidthEffect),
			);
			const livePreviewChanged =
				transaction.startState.field(editorLivePreviewField, false) !==
				transaction.state.field(editorLivePreviewField, false);
			if (transaction.docChanged || relevantEffect || livePreviewChanged) {
				return buildDecorations(host, transaction.state);
			}
			return decorations;
		},
		provide: (field) => [
			EditorView.decorations.from(field, (value) => value.deco),
			EditorView.atomicRanges.of(
				(view) => view.state.field(field, false)?.atomic ?? Decoration.none,
			),
		],
	});

	class SectionVariantsViewPlugin implements PluginValue {
		private widthDispatchTimer: number | undefined;
		private readonly resizeObserver: ResizeObserver;

		constructor(private readonly view: EditorView) {
			editorViews.add(view);
			this.resizeObserver = new ResizeObserver((entries) => {
				const entry = entries.at(-1);
				if (entry) this.deferWidthUpdate(entry.contentRect.width);
			});
			this.resizeObserver.observe(view.dom);
			this.deferWidthUpdate(view.dom.clientWidth);
		}

		destroy(): void {
			this.resizeObserver.disconnect();
			if (this.widthDispatchTimer !== undefined) {
				window.clearTimeout(this.widthDispatchTimer);
			}
			editorViews.delete(this.view);
		}

		private deferWidthUpdate(width: number): void {
			if (this.widthDispatchTimer !== undefined) {
				window.clearTimeout(this.widthDispatchTimer);
			}
			this.widthDispatchTimer = window.setTimeout(() => {
				this.widthDispatchTimer = undefined;
				if (
					!editorViews.has(this.view) ||
					this.view.state.field(editorWidthField) === width
				) {
					return;
				}
				this.view.dispatch({ effects: editorWidthEffect.of(width) });
			}, 0);
		}

	}

	return [
		refreshField,
		editorWidthField,
		EditorState.changeFilter.of((transaction) => {
			if (!transaction.docChanged) return true;
			// Vault/process updates and plugin mutations are unannotated and may
			// intentionally change structure. Guard only editor-originated input,
			// deletion, history, completion, paste, cut, and drop transactions.
			if (transaction.annotation(Transaction.userEvent) === undefined) {
				return true;
			}
			if (!transaction.startState.field(editorLivePreviewField, false)) {
				return true;
			}
			const info = transaction.startState.field(editorInfoField, false);
			const path = info?.file?.path;
			if (!path) return true;
			const parsed = host.parse(transaction.startState.doc.toString());
			const spans = collectEditableSpans(
				host,
				transaction.startState.field(editorWidthField),
				path,
				parsed.source,
				parsed.roots,
			);
			const changes: DocumentChange[] = [];
			transaction.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
				changes.push({ from, to, inserted: inserted.toString() });
			});
			return changesAreWithinEditableSpans(parsed, spans, changes);
		}),
		decorationsField,
		ViewPlugin.fromClass(SectionVariantsViewPlugin),
		Prec.high(keymap.of([
			{
				key: 'Escape',
				run(view) {
					const info = view.state.field(editorInfoField, false);
					const path = info?.file?.path;
					if (!path) return false;
					const parsed = host.parse(view.state.doc.toString());
					const editing = parsed.blocks.find((block) =>
						host.store.getEditingVariant(path, block),
					);
					if (!editing) return false;
					host.store.setEditingVariant(path, editing);
					view.dispatch({ effects: refreshEffect.of() });
					return true;
				},
			},
		])),
	];
}

function collectEditableSpans(
	host: SectionVariantsHost,
	editorWidth: number,
	path: string,
	source: string,
	blocks: readonly VariantBlock[],
): EditableSpan[] {
	const spans: EditableSpan[] = [];
	for (const block of blocks) {
		if (!block.valid || !block.closing) continue;
		const state = host.store.resolve(path, block);
		const autoColumns =
			state.view === 'auto' &&
			hasRoomForColumns(
				editorWidth,
				resolveLengthPx(state.minWidth, activeDocument.body),
				block.variants.length,
			);
		const mode =
			state.view === 'auto'
				? autoColumns
					? 'columns'
					: 'toggle'
				: state.view;
		const editable = liveEditableVariants(
			block,
			mode,
			state.selectedLabel,
			state.hiddenLabels,
		);
		for (const variant of editable) {
			if (!variant.closing) continue;
			spans.push(...editableSpansForVariant(variant, source));
			spans.push(
				...collectEditableSpans(
					host,
					editorWidth,
					path,
					source,
					variant.children,
				),
			);
		}
	}
	return spans;
}

function buildDecorations(
	host: SectionVariantsHost,
	state: EditorState,
): { deco: DecorationSet; atomic: DecorationSet } {
	const livePreview = state.field(editorLivePreviewField, false);
	if (!livePreview) return { deco: Decoration.none, atomic: Decoration.none };
	const info = state.field(editorInfoField, false);
	const path = info?.file?.path;
	if (!path) return { deco: Decoration.none, atomic: Decoration.none };
	const source = state.doc.toString();
	const editorWidth = state.field(editorWidthField);
	const parsed = host.parse(source);
	const ranges: Range<Decoration>[] = [];
	const atomicRanges: Range<Decoration>[] = [];
	for (const block of parsed.roots) {
		if (!block.valid || !block.closing) continue;
		decorateBlock(
			host,
			state.doc,
			editorWidth,
			path,
			source,
			block,
			ranges,
			atomicRanges,
		);
	}
	return {
		deco: Decoration.set(ranges, true),
		atomic: Decoration.set(atomicRanges, true),
	};
}

function decorateBlock(
	host: SectionVariantsHost,
	doc: EditorState['doc'],
	editorWidth: number,
	path: string,
	source: string,
	block: VariantBlock,
	ranges: Range<Decoration>[],
	atomicRanges: Range<Decoration>[],
): void {
	if (!block.closing) return;
	const state = host.store.resolve(path, block);
	/*
	 * Resolved against the document body: there is no per-block element at
	 * decoration time. Exact for px and rem; em and ch resolve against the body
	 * font rather than the block's own inherited font, which is close enough for
	 * a stack-or-not decision.
	 */
	const autoColumns =
		state.view === 'auto' &&
		hasRoomForColumns(
			editorWidth,
			resolveLengthPx(state.minWidth, activeDocument.body),
			block.variants.length,
		);
	const mode = state.view === 'auto' ? (autoColumns ? 'columns' : 'toggle') : state.view;
	const span = blockSpan(doc, block.opening.from, block.closing.from);
	const widgetMode: LiveWidgetMode = mode === 'toggle' ? 'toggle' : 'columns';
	const decoration = Decoration.replace({
		block: true,
		widget: new LiveBlockWidget(host, path, source, block, widgetMode),
	});
	ranges.push(decoration.range(span.from, span.to));
	atomicRanges.push(decoration.range(span.from, span.to));
}

type LiveWidgetMode = 'toggle' | 'columns';

interface LiveWidgetResources {
	component: Component;
	columnObserver?: ResizeObserver;
	headers: Map<string, VariantHeaderHandle>;
	inlines: Map<string, InlineColumnEditor>;
	uiSignature: string;
	staticContentSignature: string;
}

const liveWidgetResources = new WeakMap<HTMLElement, LiveWidgetResources>();

class LiveBlockWidget extends WidgetType {
	private readonly signature: string;
	private readonly uiSignature: string;
	private readonly staticContentSignature: string;

	constructor(
		private readonly host: SectionVariantsHost,
		private readonly path: string,
		private readonly source: string,
		private readonly block: VariantBlock,
		private readonly mode: LiveWidgetMode,
	) {
		super();
		/*
		 * Captured eagerly. CodeMirror calls `eq(newWidget)` on the OLD widget,
		 * so if this were computed lazily both sides would read the same current
		 * store state and always compare equal — the widget would never update.
		 */
		const state = host.store.resolve(path, block);
		this.uiSignature = [
			mode,
			state.selectedLabel,
			state.view,
			block.attributes.name ?? '',
			String(state.differsFromAuthored),
			String(host.store.settings.showIndicators),
			state.responsive,
			state.minWidth,
			state.widths ?? '',
			[...state.hiddenLabels].sort().join(','),
			block.variants.map((variant) => variant.label).join('\u0001'),
		].join('\u0000');
		const editable = editableVariantsForMode(host, path, block, mode);
		this.staticContentSignature = staticVariantSignature(
			source,
			block,
			editable,
		);
		this.signature = [
			path,
			block.identityKey,
			widgetPositionIdentity(block),
			this.uiSignature,
			// Content, so edits inside the block still rebuild it.
			block.closing
				? source.slice(block.opening.from, block.closing.to)
				: source.slice(block.opening.from),
		].join('\u0000');
	}

	eq(other: LiveBlockWidget): boolean {
		return other.signature === this.signature;
	}

	toDOM(view: EditorView): HTMLElement {
		const root = createOwnerDocumentDiv(view.dom);
		root.addClass(
			'section-variants-root',
			'section-variants-live-widget',
			`section-variants-live-${this.mode}`,
		);
		root.dataset.blockKey = this.block.identityKey;
		renderLiveToolbar(this.host, this.path, this.block, this.mode, root, view);
		const component = new Component();
		component.load();
		const resources: LiveWidgetResources = {
			component,
			headers: new Map(),
			inlines: new Map(),
			uiSignature: this.uiSignature,
			staticContentSignature: this.staticContentSignature,
		};
		liveWidgetResources.set(root, resources);
		const contentMode = this.mode === 'toggle' ? 'toggle' : 'columns';
		root.dataset.currentView = contentMode;
		const content = root.createDiv({
			cls: `section-variants-content section-variants-view-${contentMode}`,
		});
		if (this.block.attributes.name) {
			content.createDiv({
				cls: 'section-variants-block-name',
				text: this.block.attributes.name,
			});
		}
		const state = this.host.store.resolve(this.path, this.block);
		content.dataset.responsive = state.responsive;
		content.style.setProperty('--section-variants-min-width', state.minWidth);
		if (this.mode === 'toggle') {
			const variant = editableVariantsForMode(
				this.host,
				this.path,
				this.block,
				this.mode,
			)[0];
			if (variant) {
				const panel = content.createDiv({ cls: 'section-variants-panel is-editing' });
				panel.dataset.label = variant.label;
				resources.headers.set(variant.normalizedLabel, createVariantHeader({
					parent: panel,
					source: this.source,
					variant,
				}));
				resources.inlines.set(variant.normalizedLabel, new InlineColumnEditor({
					host: this.host,
					path: this.path,
					source: this.source,
					variant,
					outerView: view,
					parent: panel,
					component,
					onExit: () => undefined,
				}));
			}
			return root;
		}
		if (
			state.widths &&
			!/[;{}]/u.test(state.widths) &&
			root.ownerDocument.defaultView?.CSS?.supports(
				'grid-template-columns',
				state.widths,
			)
		) {
			content.style.gridTemplateColumns = state.widths;
		}
		content.toggleClass(
			'section-variants-columns-stack',
			state.responsive === 'stack',
		);
		content.toggleClass(
			'section-variants-columns-scroll',
			state.responsive === 'scroll',
		);
		for (const variant of this.block.variants) {
			if (state.hiddenLabels.has(variant.normalizedLabel)) continue;
			const panel = content.createDiv({ cls: 'section-variants-panel' });
			panel.dataset.label = variant.label;
			resources.headers.set(variant.normalizedLabel, createVariantHeader({
				parent: panel,
				source: this.source,
				variant,
				onHide: () => {
					this.host.store.toggleHidden(this.path, this.block, variant.label);
				},
			}));
			panel.addClass('is-editing');
			resources.inlines.set(variant.normalizedLabel, new InlineColumnEditor({
				host: this.host,
				path: this.path,
				source: this.source,
				variant,
				outerView: view,
				parent: panel,
				component,
				onExit: () => undefined,
			}));
		}
		if (resources.inlines.size === 0) {
			const empty = content.createDiv({ cls: 'section-variants-empty' });
			setIcon(empty.createSpan(), 'layers');
			empty.createSpan({ text: 'All columns are hidden.' });
			const restore = empty.createEl('button', {
				type: 'button',
				text: 'Restore columns',
			});
			restore.addEventListener('click', () => {
				this.host.store.restoreColumns(this.path, this.block);
			});
		}
		resources.columnObserver = new ResizeObserver(() => {
			syncColumnSeparators(content);
		});
		resources.columnObserver.observe(content);
		syncColumnSeparators(content);
		return root;
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		const resources = liveWidgetResources.get(dom);
		if (
			!resources ||
			resources.uiSignature !== this.uiSignature ||
			resources.staticContentSignature !== this.staticContentSignature
		) {
			return false;
		}
		const variants = editableVariantsForMode(
			this.host,
			this.path,
			this.block,
			this.mode,
		);
		if (resources.inlines.size !== variants.length) return false;
		for (const variant of variants) {
			const header = resources.headers.get(variant.normalizedLabel);
			const inline = resources.inlines.get(variant.normalizedLabel);
			if (!header || !inline?.rebind(this.source, variant, view)) return false;
			header.rebind(this.source, variant);
		}
		dom.dataset.blockKey = this.block.identityKey;
		return true;
	}

	destroy(dom: HTMLElement): void {
		const resources = liveWidgetResources.get(dom);
		resources?.columnObserver?.disconnect();
		for (const inline of resources?.inlines.values() ?? []) inline.destroy();
		resources?.component.unload();
		liveWidgetResources.delete(dom);
	}

	ignoreEvent(): boolean {
		// The widget owns its controls and nested CodeMirror editors. Letting the
		// outer editor interpret these events would steal their input.
		return true;
	}
}

function renderLiveToolbar(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	mode: LiveWidgetMode,
	parent: HTMLElement,
	view: EditorView,
): void {
	const toolbar = parent.createDiv({ cls: 'section-variants-toolbar' });
	toolbar.setAttribute('role', 'toolbar');
	toolbar.setAttribute('aria-label', 'Section variants in live preview');
	createBlockControls({
		host,
		path,
		block,
		parent: toolbar,
		mode,
		onSelectLabel: (label, event) => {
			if (isNoteWideSelection(event)) {
				const parsed = host.parse(view.state.doc.toString());
				const result = host.store.applyLabelAcrossNote(path, parsed, label);
				new Notice(
					`Applied to ${result.applied} block${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}.`,
				);
				return;
			}
			void selectLiveVariant(host, path, block, label, view);
		},
	});
}

async function selectLiveVariant(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	label: string,
	view: EditorView,
): Promise<void> {
	const persistent = await host.ensurePersistentIdentity(path, block);
	if (!persistent) return;
	host.store.setSelectedLabel(path, persistent, label);
	view.dispatch({ effects: refreshEffect.of() });
}

function editableVariantsForMode(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	mode: LiveWidgetMode,
): VariantSection[] {
	const state = host.store.resolve(path, block);
	return liveEditableVariants(
		block,
		mode,
		state.selectedLabel,
		state.hiddenLabels,
	);
}

function staticVariantSignature(
	source: string,
	block: VariantBlock,
	editable: readonly VariantSection[],
): string {
	const editableLabels = new Set(
		editable.map((variant) => variant.normalizedLabel),
	);
	return block.variants
		.filter((variant) => !editableLabels.has(variant.normalizedLabel))
		.map((variant) => source.slice(variant.content.from, variant.content.to))
		.join('\u0000');
}

function createOwnerDocumentDiv(root: HTMLElement): HTMLDivElement {
	const ownerWindow = root.ownerDocument.win as Window & {
		createDiv(): HTMLDivElement;
	};
	return ownerWindow.createDiv();
}
