import {
	EditorState,
	Extension,
	Range,
	StateEffect,
	StateField,
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
	MarkdownRenderer,
} from 'obsidian';
import { normalizeLabel, VariantBlock, VariantSection } from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { VariantBlockRenderer } from '../ui/block-renderer';
import { createSegmentedControl } from '../ui/segmented-control';
import { hasRoomForColumns, resolveLengthPx } from '../ui/css-length';

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
	const decorationsField = StateField.define<DecorationSet>({
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
		provide: (field) => EditorView.decorations.from(field),
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
		decorationsField,
		ViewPlugin.fromClass(SectionVariantsViewPlugin),
		keymap.of([
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
		]),
	];
}

function buildDecorations(
	host: SectionVariantsHost,
	state: EditorState,
): DecorationSet {
	const livePreview = state.field(editorLivePreviewField, false);
	if (!livePreview) return Decoration.none;
	const info = state.field(editorInfoField, false);
	const path = info?.file?.path;
	if (!path) return Decoration.none;
	const source = state.doc.toString();
	const editorWidth = state.field(editorWidthField);
	const parsed = host.parse(source);
	const ranges: Range<Decoration>[] = [];
	for (const block of parsed.roots) {
		if (!block.valid || !block.closing) continue;
		decorateBlock(host, editorWidth, path, source, block, ranges);
	}
	return Decoration.set(
		ranges.sort((left, right) => left.from - right.from || left.to - right.to),
		true,
	);
}

function decorateBlock(
	host: SectionVariantsHost,
	editorWidth: number,
	path: string,
	source: string,
	block: VariantBlock,
	ranges: Range<Decoration>[],
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
	const editingLabel = host.store.getEditingVariant(path, block);

	if (mode === 'columns' && !editingLabel) {
		ranges.push(
			Decoration.replace({
				block: true,
				widget: new LiveBlockWidget(host, path, source, block, 'columns'),
			}).range(block.opening.from, block.closing.to),
		);
		return;
	}

	ranges.push(
		Decoration.replace({
			block: true,
			widget: new LiveBlockWidget(
				host,
				path,
				source,
				block,
				editingLabel ? 'editing-columns' : 'toolbar',
			),
		}).range(block.opening.from, block.opening.to),
	);
	ranges.push(hiddenRange(block.closing.from, block.closing.to));

	const activeLabel = editingLabel ?? state.selectedLabel;
	for (const variant of block.variants) {
		if (!variant.closing) continue;
		const active = variant.normalizedLabel === normalizeLabel(activeLabel);
		if (!active) {
			const widget =
				mode === 'toggle' && state.inactiveBehavior === 'collapsed'
					? new InactiveVariantWidget(host, path, block, variant)
					: undefined;
			ranges.push(
				Decoration.replace({ block: true, widget }).range(
					variant.opening.from,
					variant.closing.to,
				),
			);
			continue;
		}
		ranges.push(hiddenRange(variant.opening.from, variant.opening.to));
		ranges.push(hiddenRange(variant.closing.from, variant.closing.to));
		for (const child of variant.children) {
			decorateBlock(host, editorWidth, path, source, child, ranges);
		}
	}
}

function hiddenRange(from: number, to: number): Range<Decoration> {
	return Decoration.replace({}).range(from, to);
}

class InactiveVariantWidget extends WidgetType {
	private readonly signature: string;

	constructor(
		private readonly host: SectionVariantsHost,
		private readonly path: string,
		private readonly block: VariantBlock,
		private readonly variant: VariantSection,
	) {
		super();
		this.signature = `${path}\u0000${block.identityKey}\u0000${variant.normalizedLabel}`;
	}

	eq(other: InactiveVariantWidget): boolean {
		return other.signature === this.signature;
	}

	toDOM(view: EditorView): HTMLElement {
		const button = createEl('button');
		button.type = 'button';
		button.addClass('section-variants-inactive-placeholder');
		button.setText(`${this.variant.label} — collapsed`);
		button.addEventListener('click', () => {
			void this.select(view);
		});
		return button;
	}

	ignoreEvent(): boolean {
		return false;
	}

	private async select(view: EditorView): Promise<void> {
		if (!(await this.host.ensurePersistentIdentity(this.path, this.block))) return;
		this.host.store.setSelectedLabel(this.path, this.block, this.variant.label);
		view.dispatch({
			effects: refreshEffect.of(),
			selection: { anchor: this.variant.content.from },
		});
		view.focus();
	}
}

type LiveWidgetMode = 'toolbar' | 'columns' | 'editing-columns';

class LiveBlockWidget extends WidgetType {
	private readonly components = new WeakMap<HTMLElement, Component>();
	private readonly signature: string;

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
		this.signature = [
			path,
			block.identityKey,
			mode,
			state.selectedLabel,
			state.view,
			state.responsive,
			state.minWidth,
			state.widths ?? '',
			[...state.hiddenLabels].sort().join(','),
			host.store.getEditingVariant(path, block) ?? '',
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
		const root = createDiv();
		root.addClass('section-variants-root', 'section-variants-live-widget');
		if (this.mode === 'toolbar') {
			this.renderToolbar(root, view, false);
			return root;
		}

		this.renderToolbar(root, view, this.mode === 'editing-columns');
		const component = new Component();
		component.load();
		this.components.set(root, component);
		const columns = root.createDiv({
			cls: 'section-variants-content section-variants-view-columns',
		});
		const state = this.host.store.resolve(this.path, this.block);
		columns.dataset.responsive = state.responsive;
		columns.style.setProperty('--section-variants-min-width', state.minWidth);
		if (
			state.widths &&
			!/[;{}]/u.test(state.widths) &&
			window.CSS?.supports('grid-template-columns', state.widths)
		) {
			columns.style.gridTemplateColumns = state.widths;
		}
		for (const variant of this.block.variants) {
			if (state.hiddenLabels.has(variant.normalizedLabel)) continue;
			const panel = columns.createDiv({ cls: 'section-variants-panel' });
			const header = panel.createDiv({ cls: 'section-variants-column-header' });
			header.createSpan({ text: variant.label });
			const edit = header.createEl('button', {
				type: 'button',
				cls: 'mod-cta',
				text: 'Edit',
				attr: { 'aria-label': `Edit ${variant.label}` },
			});
			edit.addEventListener('click', () => {
				void this.editVariant(view, variant);
			});
			void renderVariantPreview(
				this.host,
				this.path,
				this.source,
				variant,
				panel,
				component,
			);
		}
		return root;
	}

	destroy(dom: HTMLElement): void {
		this.components.get(dom)?.unload();
	}

	ignoreEvent(): boolean {
		return false;
	}

	private renderToolbar(
		root: HTMLElement,
		view: EditorView,
		showDone: boolean,
	): void {
		const toolbar = root.createDiv({ cls: 'section-variants-toolbar' });
		toolbar.setAttribute('role', 'toolbar');
		toolbar.setAttribute('aria-label', 'Section variants in live preview');
		const state = this.host.store.resolve(this.path, this.block);
		const active = this.block.variants.find(
			(variant) => variant.normalizedLabel === normalizeLabel(state.selectedLabel),
		);
		createSegmentedControl(toolbar, {
			cls: 'section-variants-labels',
			ariaLabel: 'Variant',
			emphasized: true,
			value: active?.label,
			options: this.block.variants.map((variant) => ({
				value: variant.label,
				text: variant.label,
				label: variant.label,
			})),
			onSelect: (label) => void this.selectVariant(view, label),
		});
		if (showDone) {
			const done = toolbar.createEl('button', {
				type: 'button',
				cls: 'section-variants-done-editing',
				text: 'Done editing',
			});
			done.addEventListener('click', () => {
				this.host.store.setEditingVariant(this.path, this.block);
				view.dispatch({ effects: refreshEffect.of() });
				view.focus();
			});
		}
		const mode = toolbar.createSpan({
			cls: 'section-variants-live-mode',
			text: state.view === 'auto' ? 'Auto' : capitalize(state.view),
		});
		mode.setAttribute('aria-label', `Current view: ${state.view}`);
	}

	private async editVariant(
		view: EditorView,
		variant: VariantSection,
	): Promise<void> {
		if (!(await this.host.ensurePersistentIdentity(this.path, this.block))) return;
		this.host.store.setEditingVariant(this.path, this.block, variant.label);
		this.host.store.setSelectedLabel(this.path, this.block, variant.label);
		view.dispatch({
			effects: refreshEffect.of(),
			selection: { anchor: variant.content.from },
		});
		view.focus();
	}

	private async selectVariant(
		view: EditorView,
		label: string,
	): Promise<void> {
		if (!(await this.host.ensurePersistentIdentity(this.path, this.block))) return;
		this.host.store.setSelectedLabel(this.path, this.block, label);
		view.dispatch({ effects: refreshEffect.of() });
	}
}

async function renderVariantPreview(
	host: SectionVariantsHost,
	path: string,
	source: string,
	variant: VariantSection,
	target: HTMLElement,
	component: Component,
): Promise<void> {
	let cursor = variant.content.from;
	for (const child of [...variant.children].sort(
		(left, right) => left.range.from - right.range.from,
	)) {
		if (child.range.from > cursor) {
			await MarkdownRenderer.render(
				host.app,
				source.slice(cursor, child.range.from),
				target,
				path,
				component,
			);
		}
		const nested = target.createDiv({ cls: 'section-variants-nested' });
		component.addChild(
			new VariantBlockRenderer(host, nested, path, source, child),
		);
		cursor = child.range.to;
	}
	if (cursor < variant.content.to) {
		await MarkdownRenderer.render(
			host.app,
			source.slice(cursor, variant.content.to),
			target,
			path,
			component,
		);
	}
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
