import {
	EditorState,
	Extension,
	Prec,
	Range,
	StateEffect,
	StateField,
	Text,
	TransactionSpec,
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
import {
	normalizeLabel,
	ParsedNote,
	VariantBlock,
	VariantSection,
} from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { VariantBlockRenderer } from '../ui/block-renderer';
import { createSegmentedControl } from '../ui/segmented-control';
import {
	clearLengthCache,
	hasRoomForColumns,
	resolveLengthPx,
} from '../ui/css-length';
import {
	blockSpan,
	fenceLineRange,
	selectionConfinedTo,
	selectionTouchesSpan,
} from './ranges';

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

/**
 * Decorations plus the two derived pieces the field needs to keep around: the
 * subset that must be atomic, and which blocks are currently revealed.
 */
interface VariantDecorations {
	deco: DecorationSet;
	atomic: DecorationSet;
	revealed: ReadonlySet<string>;
}

const EMPTY_DECORATIONS: VariantDecorations = {
	deco: Decoration.none,
	atomic: Decoration.none,
	revealed: new Set(),
};

interface ParseMemo {
	doc: Text;
	source: string;
	parsed: ParsedNote;
}

export function createLivePreviewExtension(
	host: SectionVariantsHost,
): Extension {
	/*
	 * Parse memo keyed on `Text` identity. CodeMirror shares the `Text`
	 * instance when the document is unchanged, so a selection-only transaction
	 * reuses this without re-running `doc.toString()` — which was previously
	 * O(doc) on every single rebuild, before `host.parse`'s own cache was even
	 * consulted. Scoped per editor via this closure.
	 */
	let parseMemo: ParseMemo | undefined;
	function parseFor(state: EditorState): ParseMemo {
		if (parseMemo?.doc === state.doc) return parseMemo;
		const source = state.doc.toString();
		parseMemo = { doc: state.doc, source, parsed: host.parse(source) };
		return parseMemo;
	}

	function build(state: EditorState): VariantDecorations {
		if (!state.field(editorLivePreviewField, false)) return EMPTY_DECORATIONS;
		const path = state.field(editorInfoField, false)?.file?.path;
		if (!path) return EMPTY_DECORATIONS;

		const { source, parsed } = parseFor(state);
		const revealed = computeRevealed(host, path, parsed, state);
		return buildDecorations(host, state, path, source, parsed, revealed);
	}

	const decorationsField = StateField.define<VariantDecorations>({
		create: (state) => build(state),
		update(value, transaction) {
			const structural =
				transaction.docChanged ||
				transaction.effects.some(
					(effect) =>
						effect.is(refreshEffect) || effect.is(editorWidthEffect),
				) ||
				transaction.startState.field(editorLivePreviewField, false) !==
					transaction.state.field(editorLivePreviewField, false);

			if (!structural && !transaction.selection) return value;

			/*
			 * On a selection-only change, recompute just the revealed set —
			 * integer comparisons, no string work — and reuse the existing
			 * decorations verbatim when it has not changed. This is what keeps
			 * arrow keys from triggering a full rebuild.
			 */
			if (!structural) {
				if (!transaction.state.field(editorLivePreviewField, false)) {
					return value;
				}
				const path = transaction.state.field(editorInfoField, false)?.file
					?.path;
				if (!path) return value;
				const { parsed } = parseFor(transaction.state);
				const revealed = computeRevealed(
					host,
					path,
					parsed,
					transaction.state,
				);
				if (sameKeys(revealed, value.revealed)) return value;
			}

			return build(transaction.state);
		},
		provide: (field) => [
			EditorView.decorations.from(field, (value) => value.deco),
			/*
			 * Without this, `Decoration.replace` hid the fences but left every
			 * offset inside them a valid cursor position, so Backspace deleted
			 * an invisible `:` and silently turned `:::` into `::`. CodeMirror's
			 * `deleteBy` consults this facet and removes the whole range
			 * instead. Explicit `dispatch({ selection })` is unaffected, so the
			 * Edit-button workflow still works.
			 */
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
				// A resize is the cheapest reliable signal that font-relative
				// lengths may now resolve differently.
				clearLengthCache();
				this.view.dispatch({ effects: editorWidthEffect.of(width) });
			}, 0);
		}
	}

	return [
		refreshField,
		editorWidthField,
		decorationsField,
		ViewPlugin.fromClass(SectionVariantsViewPlugin),
		// Obsidian binds Escape internally; a default-precedence keymap does not
		// reliably win. Safe to raise because the handler returns false when no
		// block is in edit mode.
		Prec.high(
			keymap.of([
				{
					key: 'Escape',
					run(view) {
						const path = view.state.field(editorInfoField, false)?.file?.path;
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
		),
	];
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	if (left.size !== right.size) return false;
	for (const key of left) if (!right.has(key)) return false;
	return true;
}

/** Resolved display mode for a block, shared by reveal and decoration passes. */
function resolveMode(
	host: SectionVariantsHost,
	editorWidth: number,
	path: string,
	block: VariantBlock,
): 'toggle' | 'columns' {
	const state = host.store.resolve(path, block);
	if (state.view !== 'auto') return state.view === 'columns' ? 'columns' : 'toggle';
	const fits = hasRoomForColumns(
		editorWidth,
		resolveLengthPx(state.minWidth, activeDocument.body),
		block.variants.length,
	);
	return fits ? 'columns' : 'toggle';
}

/**
 * Which blocks should show raw source because the caret is inside them.
 *
 * Three clauses:
 *  1. Explicit Edit mode owns the block — `editVariant` deliberately parks the
 *     caret inside, and a naive "caret in block" rule would immediately blow
 *     the columns UI back to raw text.
 *  2. The selection touches the block's line span, endpoints included.
 *  3. …but not when it is confined to the active variant's *undecorated*
 *     content. In toggle mode that content is already plain editor text, so
 *     ordinary typing there must not flip the block.
 */
function computeRevealed(
	host: SectionVariantsHost,
	path: string,
	parsed: ParsedNote,
	state: EditorState,
): Set<string> {
	const revealed = new Set<string>();
	const editorWidth = state.field(editorWidthField);
	const doc = state.doc;

	const visit = (block: VariantBlock): void => {
		if (!block.valid || !block.closing) return;

		if (host.store.getEditingVariant(path, block) !== undefined) {
			// Clause 1: explicit edit mode wins; recurse so nested blocks still
			// get their own chance to reveal.
			for (const variant of block.variants) {
				for (const child of variant.children) visit(child);
			}
			return;
		}

		const span = blockSpan(doc, block.opening.from, block.closing.to);
		// Clause 2: the selection touches the block at all.
		if (!selectionTouchesSpan(state.selection.ranges, span)) return;

		const mode = resolveMode(host, editorWidth, path, block);
		if (mode === 'toggle') {
			const resolved = host.store.resolve(path, block);
			const active = block.variants.find(
				(variant) =>
					variant.normalizedLabel === normalizeLabel(resolved.selectedLabel),
			);
			/*
			 * Clause 3: typing inside the active variant's already-undecorated
			 * content must not flip the block. Columns mode has no undecorated
			 * content, so it always falls through and reveals.
			 */
			if (active && selectionConfinedTo(state.selection.ranges, active.content)) {
				for (const child of active.children) visit(child);
				return;
			}
		}

		revealed.add(block.identityKey);
	};

	for (const block of parsed.roots) visit(block);
	return revealed;
}

function buildDecorations(
	host: SectionVariantsHost,
	state: EditorState,
	path: string,
	source: string,
	parsed: ParsedNote,
	revealed: ReadonlySet<string>,
): VariantDecorations {
	const editorWidth = state.field(editorWidthField);
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
			revealed,
			ranges,
			atomicRanges,
		);
	}
	return {
		// `Decoration.set`'s second argument means "sort these". A hand-written
		// comparator was previously applied first; it ignored `startSide`, which
		// can produce an ordering RangeSet rejects.
		deco: Decoration.set(ranges, true),
		atomic: Decoration.set(atomicRanges, true),
		revealed,
	};
}

function decorateBlock(
	host: SectionVariantsHost,
	doc: Text,
	editorWidth: number,
	path: string,
	source: string,
	block: VariantBlock,
	revealed: ReadonlySet<string>,
	ranges: Range<Decoration>[],
	atomicRanges: Range<Decoration>[],
): void {
	if (!block.closing) return;

	// Revealed blocks emit nothing at all, so their raw source — including any
	// nested block — is directly editable.
	if (revealed.has(block.identityKey)) return;

	const state = host.store.resolve(path, block);
	const mode = resolveMode(host, editorWidth, path, block);
	const editingLabel = host.store.getEditingVariant(path, block);

	const hideFence = (from: number): void => {
		const range = fenceLineRange(doc, from);
		if (range.to <= range.from) return;
		const decoration = Decoration.replace({});
		ranges.push(decoration.range(range.from, range.to));
		// Only the fences are atomic. Making the block widgets atomic too would
		// turn a single Backspace into deleting an entire block or variant.
		atomicRanges.push(decoration.range(range.from, range.to));
	};

	if (mode === 'columns' && !editingLabel) {
		const span = blockSpan(doc, block.opening.from, block.closing.from);
		ranges.push(
			Decoration.replace({
				block: true,
				widget: new LiveBlockWidget(host, path, source, block, 'columns'),
			}).range(span.from, span.to),
		);
		return;
	}

	const openingSpan = blockSpan(doc, block.opening.from, block.opening.from);
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
		}).range(openingSpan.from, openingSpan.to),
	);
	hideFence(block.closing.from);

	const activeLabel = editingLabel ?? state.selectedLabel;
	for (const variant of block.variants) {
		if (!variant.closing) continue;
		const active = variant.normalizedLabel === normalizeLabel(activeLabel);
		if (!active) {
			const span = blockSpan(doc, variant.opening.from, variant.closing.to);
			const widget =
				mode === 'toggle' && state.inactiveBehavior === 'collapsed'
					? new InactiveVariantWidget(host, path, block, variant)
					: undefined;
			ranges.push(
				Decoration.replace({ block: true, widget }).range(span.from, span.to),
			);
			continue;
		}
		hideFence(variant.opening.from);
		hideFence(variant.closing.from);
		for (const child of variant.children) {
			decorateBlock(
				host,
				doc,
				editorWidth,
				path,
				source,
				child,
				revealed,
				ranges,
				atomicRanges,
			);
		}
	}
}

/**
 * Dispatch, then restore focus only if the editor already had it.
 *
 * An unconditional `view.focus()` would pop the on-screen keyboard on every
 * toolbar tap on mobile, which is worse than the bug it fixes.
 */
function dispatchAndRestoreFocus(view: EditorView, spec: TransactionSpec): void {
	const hadFocus = view.hasFocus;
	view.dispatch(spec);
	if (hadFocus) view.focus();
}

/** Applies the toolbar-visibility setting to a widget root. */
function applyToolbarVisibility(
	host: SectionVariantsHost,
	root: HTMLElement,
	path: string,
	block: VariantBlock,
): void {
	const state = host.store.resolve(path, block);
	root.toggleClass(
		'section-variants-toolbar-always',
		state.toolbarPinned || host.store.settings.toolbarVisibility === 'always',
	);
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
		/*
		 * Includes absolute positions and the RAW label. Keying on the
		 * normalized label meant a case-only rename never updated the button,
		 * since `toDOM` renders the raw one; omitting positions meant an edit
		 * above the block left this widget in place with a stale
		 * `content.from`, which is dispatched as a selection anchor below.
		 */
		this.signature = [
			path,
			block.identityKey,
			variant.opening.from,
			variant.closing?.to ?? -1,
			variant.content.from,
			variant.label,
		].join('\u0000');
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
		// Deliberately moves the caret, so focus unconditionally.
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
	/** Block text only, plus its origin, rather than the whole document. */
	private readonly blockText: string;
	private readonly baseOffset: number;

	constructor(
		private readonly host: SectionVariantsHost,
		private readonly path: string,
		source: string,
		private readonly block: VariantBlock,
		private readonly mode: LiveWidgetMode,
	) {
		super();
		this.baseOffset = block.opening.from;
		this.blockText = block.closing
			? source.slice(block.opening.from, block.closing.to)
			: source.slice(block.opening.from);
		/*
		 * Captured eagerly. CodeMirror calls `eq(newWidget)` on the OLD widget,
		 * so if this were computed lazily both sides would read the same current
		 * store state and always compare equal — the widget would never update.
		 *
		 * Absolute positions are included: an edit *above* the block leaves the
		 * text slice identical, so without them `eq()` returned true and the
		 * stale widget's offsets were later dispatched as selection anchors.
		 */
		const state = host.store.resolve(path, block);
		this.signature = [
			path,
			block.identityKey,
			block.opening.from,
			block.closing?.to ?? -1,
			mode,
			state.selectedLabel,
			state.view,
			state.responsive,
			state.minWidth,
			state.widths ?? '',
			[...state.hiddenLabels].sort().join(','),
			host.store.getEditingVariant(path, block) ?? '',
			state.toolbarPinned ? 'pinned' : '',
			host.store.settings.toolbarVisibility,
			this.blockText,
		].join('\u0000');
	}

	eq(other: LiveBlockWidget): boolean {
		return other.signature === this.signature;
	}

	toDOM(view: EditorView): HTMLElement {
		const root = createDiv();
		root.addClass('section-variants-root', 'section-variants-live-widget');
		applyToolbarVisibility(this.host, root, this.path, this.block);
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
				this.blockText,
				this.baseOffset,
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
				dispatchAndRestoreFocus(view, { effects: refreshEffect.of() });
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
		// Deliberately moves the caret, so focus unconditionally.
		view.dispatch({
			effects: refreshEffect.of(),
			selection: { anchor: variant.content.from },
		});
		view.focus();
	}

	private async selectVariant(view: EditorView, label: string): Promise<void> {
		if (!(await this.host.ensurePersistentIdentity(this.path, this.block))) return;
		this.host.store.setSelectedLabel(this.path, this.block, label);
		// Previously dispatched without restoring focus, which left the editor
		// unfocused so Obsidian's editor hotkeys silently no-opped afterwards.
		dispatchAndRestoreFocus(view, { effects: refreshEffect.of() });
	}
}

async function renderVariantPreview(
	host: SectionVariantsHost,
	path: string,
	blockText: string,
	baseOffset: number,
	variant: VariantSection,
	target: HTMLElement,
	component: Component,
): Promise<void> {
	// Offsets are absolute; rebase them onto the block-local slice.
	const slice = (from: number, to: number): string =>
		blockText.slice(from - baseOffset, to - baseOffset);

	let cursor = variant.content.from;
	for (const child of [...variant.children].sort(
		(left, right) => left.range.from - right.range.from,
	)) {
		if (child.range.from > cursor) {
			await MarkdownRenderer.render(
				host.app,
				slice(cursor, child.range.from),
				target,
				path,
				component,
			);
		}
		const nested = target.createDiv({ cls: 'section-variants-nested' });
		component.addChild(
			new VariantBlockRenderer(host, nested, path, blockText, child),
		);
		cursor = child.range.to;
	}
	if (cursor < variant.content.to) {
		await MarkdownRenderer.render(
			host.app,
			slice(cursor, variant.content.to),
			target,
			path,
			component,
		);
	}
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
