import {
	EditorState,
	Extension,
	MapMode,
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
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import {
	Component,
	editorInfoField,
	editorLivePreviewField,
	MarkdownFileInfo,
	Notice,
	setIcon,
} from 'obsidian';
import { visibleColumnWidths } from '../core/column-ratios';
import {
	normalizeLabel,
	ParsedNote,
	VariantBlock,
	VariantSection,
} from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { createBlockControls } from '../ui/block-controls';
import { VariantBlockRenderer } from '../ui/block-renderer';
import { renderNativePreview, PreviewEdit } from '../ui/native-preview';
import { previewChange } from '../core/preview-fragment';
import { STRUCTURAL_TRANSACTION_ORIGIN } from '../core/structural-transaction';
import { syncColumnGrid, syncColumnSeparators } from '../ui/column-layout';
import {
	createVariantHeader,
	VariantHeaderHandle,
} from '../ui/variant-header';
import {
	changesRespectVariantBoundaries,
	DocumentChange,
	EditableSpan,
	editableSpansForVariant,
} from './edit-boundaries';
import { isNoteWideSelection } from './interactions';
import {
	editingPathVariant,
	NativeEditingTarget as EditingTarget,
} from './native-editing';
import { blockSpan } from './ranges';
import { NativeFrameRange, NativeFrames } from './native-frame';
import { ColumnEditor, columnEditorOwner, columnTransaction } from './column-editor';
import { isolateNativeHistory } from './history';

interface ResolvedEditingTarget {
	path: string;
	parsed: ParsedNote;
	block: VariantBlock;
	variant: VariantSection;
}

interface PreviewTarget {
	blockFrom: number;
	label: string;
}

const refreshEffect = StateEffect.define<void>();
const editingTargetEffect = StateEffect.define<EditingTarget | null>();
const refreshField = StateField.define<number>({
	create: () => 0,
	update(value, transaction) {
		return transaction.effects.some((effect) => effect.is(refreshEffect))
			? value + 1
			: value;
	},
});
const editorViews = new Set<EditorView>();
const activationCoords = new WeakMap<EditorView, { x: number; y: number }>();

/** Ask live-preview editors to rebuild, optionally for one note only. */
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
	const editingField = StateField.define<EditingTarget | null>({
		create: () => null,
		update(value, transaction) {
			let next = value;
			if (next && transaction.docChanged) {
				const blockFrom = transaction.changes.mapPos(next.blockFrom, 1, MapMode.TrackAfter);
				next = blockFrom === null ? null : { ...next, blockFrom };
			}
			let explicit = false;
			for (const effect of transaction.effects) {
				if (!effect.is(editingTargetEffect)) continue;
				next = effect.value;
				explicit = true;
			}
			if (!next) return null;
			const resolved = resolveEditingTarget(host, transaction.state, next);
			if (!resolved) return null;
			if (
				next.blockFrom !== resolved.block.opening.from ||
				normalizeLabel(next.label) !== resolved.variant.normalizedLabel
			) {
				next = {
					blockFrom: resolved.block.opening.from,
					label: resolved.variant.label,
				};
			}
			if (
				!explicit &&
				transaction.selection &&
				!selectionTouchesRange(
					transaction.state,
					resolved.variant.content.from,
					resolved.variant.content.to,
				)
			) {
				return null;
			}
			return next;
		},
	});

	interface VariantDecorations {
		deco: DecorationSet;
		atomic: DecorationSet;
		frames: NativeFrameRange[];
	}
	const decorationsField = StateField.define<VariantDecorations>({
		create(state) {
			return buildDecorations(host, state, state.field(editingField));
		},
		update(decorations, transaction) {
			const relevantEffect = transaction.effects.some(
				(effect) =>
					effect.is(refreshEffect) || effect.is(editingTargetEffect),
			);
			const livePreviewChanged =
				transaction.startState.field(editorLivePreviewField, false) !==
				transaction.state.field(editorLivePreviewField, false);
			const editingChanged =
				transaction.startState.field(editingField) !==
				transaction.state.field(editingField);
			if (
				transaction.docChanged ||
				relevantEffect ||
				livePreviewChanged ||
				editingChanged
			) {
				return buildDecorations(
					host,
					transaction.state,
					transaction.state.field(editingField),
				);
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
		private frames?: NativeFrames;
		private column?: ColumnEditor;
		private columnPanel?: HTMLElement;
		private columnLabel?: string;
		private syncPending = false;
		private refreshColumn = false;
		private readonly ownerDocument: Document;
		private destroyed = false;
		private pointerStart?: PreviewTarget & {
			x: number;
			y: number;
			pointerId: number;
		};

		constructor(private readonly view: EditorView) {
			this.ownerDocument = view.dom.ownerDocument;
			if (!view.state.field(editorInfoField, false)?.editor) return;
			const owner: MarkdownFileInfo & { getViewType?: () => string } = view.state.field(editorInfoField);
			if (!(columnEditorOwner in owner) && owner.getViewType?.() === 'markdown') editorViews.add(view);
			this.frames = new NativeFrames(view, () => view.state.field(decorationsField).frames);
			this.ownerDocument.addEventListener(
				'pointerdown',
				this.handlePointerDown,
				true,
			);
			this.ownerDocument.addEventListener('pointerup', this.handlePointerUp, true);
			this.ownerDocument.addEventListener('pointermove', this.handlePointerMove, true);
			this.ownerDocument.addEventListener('scroll', this.handlePointerCancel, true);
			this.ownerDocument.addEventListener('pointercancel', this.handlePointerCancel, true);
			this.ownerDocument.addEventListener('click', this.handleClick, true);
		}

		update(update: ViewUpdate): void {
			this.frames?.update(update);
			this.refreshColumn ||= update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshEffect)));
			this.scheduleColumnSync();
		}

		private scheduleColumnSync(): void {
			if (this.syncPending) return;
			this.syncPending = true;
			queueMicrotask(() => {
				this.syncPending = false;
				if (this.destroyed) return;
				const target = this.view.state.field(editingField);
				const refresh = this.refreshColumn;
				this.refreshColumn = false;
				const resolved = target && resolveEditingTarget(host, this.view.state, target);
				const panel = resolved ? Array.from(this.view.dom.querySelectorAll<HTMLElement>('.section-variants-panel')).find(el =>
					Number(el.dataset.blockFrom) === resolved.block.opening.from && normalizeLabel(el.dataset.label ?? '') === resolved.variant.normalizedLabel &&
					el.closest('.cm-editor') === this.view.dom) : undefined;
				if (this.column && resolved && panel === this.columnPanel && resolved.variant.normalizedLabel === this.columnLabel) {
					this.column.rebind(resolved.variant);
					if (refresh) this.column.refresh(refreshEffect.of());
					return;
				}
				const hadColumn = Boolean(this.column);
				this.closeColumn();
				if (panel && resolved) {
					try {
						this.column = new ColumnEditor(host.app, this.view, panel, resolved.variant, () => {
							if (this.destroyed) return;
							const target = this.view.state.field(editingField);
							const active = target && resolveEditingTarget(host, this.view.state, target);
							const anchor = active?.block.closing
								? blockSpan(this.view.state.doc, active.block.opening.from, active.block.closing.from).to
								: this.view.state.selection.main.head;
							this.view.dispatch({ effects: editingTargetEffect.of(null), selection: { anchor } });
							this.view.focus();
						});
						this.columnPanel = panel;
						this.columnLabel = resolved.variant.normalizedLabel;
						panel.dataset.editingLabel = resolved.variant.label;
						panel.addClass('is-editing');
						this.column.focus(activationCoords.get(this.view));
						activationCoords.delete(this.view);
					} catch (error) {
						console.error('Section Variants: could not create column editor', error);
						new Notice('Section variants could not open the native column editor. Your note was not changed.');
						this.view.dispatch({ effects: editingTargetEffect.of(null) });
					}
				}
				// Refresh the previous preview only after its editor is unmounted.
				if (hadColumn) this.view.dispatch({ effects: refreshEffect.of() });
			});
		}

		private closeColumn(): void {
			this.column?.destroy();
			this.column = undefined;
			this.columnPanel?.removeClass('is-editing');
			if (this.columnPanel) delete this.columnPanel.dataset.editingLabel;
			this.columnPanel = undefined;
			this.columnLabel = undefined;
		}

		destroy(): void {
			this.destroyed = true;
			this.closeColumn();
			this.frames?.destroy();
			this.ownerDocument.removeEventListener(
				'pointerdown',
				this.handlePointerDown,
				true,
			);
			this.ownerDocument.removeEventListener('pointerup', this.handlePointerUp, true);
			this.ownerDocument.removeEventListener('pointermove', this.handlePointerMove, true);
			this.ownerDocument.removeEventListener('scroll', this.handlePointerCancel, true);
			this.ownerDocument.removeEventListener('pointercancel', this.handlePointerCancel, true);
			this.ownerDocument.removeEventListener('click', this.handleClick, true);
			editorViews.delete(this.view);
		}

		private readonly handlePointerDown = (event: PointerEvent): void => {
			const target = event.button === 0 ? this.previewTarget(event) : undefined;
			if (target && event.pointerType !== 'touch') {
				activateVariantFromPreview(host, this.view, event, target);
				return;
			}
			this.pointerStart = target
				? {
						...target,
						x: event.clientX,
						y: event.clientY,
						pointerId: event.pointerId,
					}
				: undefined;
			if (target) return;
			const active = this.view.state.field(editingField);
			if (!active) return;
			const node = event.target as Node | null;
			if (!node?.instanceOf(this.ownerDocument.defaultView!.Node)) return;
			const element = node.instanceOf(this.ownerDocument.defaultView!.Element)
				? node
				: node.parentElement;
			// A nested native editor owns its own cursor and nested variant events.
			if (element && this.view.dom.contains(element) && element.closest('.cm-editor') !== this.view.dom) return;
			if (element?.closest('.section-variants-context-menu, .suggestion-container, .menu, .modal-container')) return;
			const resolved = resolveEditingTarget(host, this.view.state, active);
			if (!resolved) {
				this.clearAfterEvent(active);
				return;
			}
			if (this.view.dom.contains(node)) {
				const root = element?.closest<HTMLElement>('.section-variants-root');
				if (root) {
					const rootBlock = resolved.parsed.blocks.find(
						(block) => block.identityKey === root.dataset.blockKey,
					);
					if (
						rootBlock &&
						active.blockFrom >= rootBlock.range.from &&
						active.blockFrom <= rootBlock.range.to
					) {
						return;
					}
					this.clearAfterEvent(active);
					return;
				}
				const position = this.view.posAtCoords({
					x: event.clientX,
					y: event.clientY,
				});
				if (
					position !== null &&
					position >= resolved.variant.content.from &&
					position <= resolved.variant.content.to
				) {
					return;
				}
			}
			this.clearAfterEvent(active);
		};

		private readonly handlePointerUp = (event: PointerEvent): void => {
			const start = this.pointerStart;
			this.pointerStart = undefined;
			if (!start || event.button !== 0 || event.pointerId !== start.pointerId) return;
			if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
			activateVariantFromPreview(host, this.view, event, start);
		};

		private readonly handlePointerCancel = (): void => {
			this.pointerStart = undefined;
		};

		private readonly handlePointerMove = (event: PointerEvent): void => {
			const start = this.pointerStart;
			if (start && (event.pointerId !== start.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)) {
				this.pointerStart = undefined;
			}
		};

		private readonly handleClick = (event: MouseEvent): void => {
			// Assistive technologies can send a click without pointer events.
			const target = event.detail === 0 ? this.previewTarget(event) : undefined;
			if (target) activateVariantFromPreview(host, this.view, event, target);
		};

		private previewTarget(event: Event): PreviewTarget | undefined {
			const target = event.target;
			if (!(target instanceof this.ownerDocument.defaultView!.Element)) return;
			const panel = target.closest<HTMLElement>('.section-variants-panel');
			if (!panel || !this.view.dom.contains(panel)) return;
			if (target.closest('.cm-editor') !== this.view.dom || panel.hasClass('is-editing')) return;
			if (isInteractivePreviewTarget(target, panel)) return;
			if (!panel.closest('.section-variants-live-widget')) return;
			const blockFrom = Number(panel.dataset.blockFrom);
			const label = panel.dataset.label;
			return Number.isFinite(blockFrom) && label
				? { blockFrom, label }
				: undefined;
		}

		private clearAfterEvent(expected: EditingTarget): void {
			window.setTimeout(() => {
				if (this.destroyed) return;
				const current = this.view.state.field(editingField);
				if (!sameTarget(current, expected)) return;
				this.view.dispatch({ effects: editingTargetEffect.of(null) });
			}, 0);
		}
	}

	return [
		refreshField,
		editingField,
		EditorState.transactionFilter.of((transaction) => {
			if (!transaction.docChanged || !transaction.isUserEvent('input')) return transaction;
			const start = transaction.startState;
			if (!start.field(editorLivePreviewField, false)) return transaction;
			const path = start.field(editorInfoField, false)?.file?.path;
			if (!path) return transaction;
			const source = start.doc.toString();
			const spans = collectEditableSpans(host, path, source, host.parse(source).roots, start.field(editingField));
			const separators: { from: number; insert: string }[] = [];
			transaction.changes.iterChanges((from, to, _newFrom, newTo, inserted) => {
				if (from !== to || !inserted.length || inserted.sliceString(inserted.length - 1) === '\n') return;
				if (spans.some((span) => span.requiresTrailingLineBreak && span.from === from)) {
					separators.push({ from: newTo, insert: '\n' });
				}
			});
			return separators.length
				? [transaction, { changes: separators, sequential: true, selection: transaction.newSelection }]
				: transaction;
		}),
		EditorState.transactionFilter.of((transaction) => {
			if (!transaction.docChanged) return transaction;
			if (transaction.annotation(Transaction.userEvent) === undefined || transaction.annotation(Transaction.userEvent) === STRUCTURAL_TRANSACTION_ORIGIN) {
				return transaction;
			}
			if (!transaction.startState.field(editorLivePreviewField, false)) {
				return transaction;
			}
			const info = transaction.startState.field(editorInfoField, false);
			const path = info?.file?.path;
			if (!path) return transaction;
			const source = transaction.startState.doc.toString();
			const parsed = host.parse(source);
			const spans = collectEditableSpans(
				host,
				path,
				source,
				parsed.roots,
				transaction.startState.field(editingField),
			);
			// Child transactions already passed that native editor's own nested-
			// structure filter. Only admit them within the active parent variant;
			// its outer fences and all sibling variants remain protected.
			if (transaction.annotation(columnTransaction)) {
				const target = transaction.startState.field(editingField);
				const active = target && resolveEditingTarget(host, transaction.startState, target);
				if (active) spans.push({ from: active.variant.content.from, to: Math.max(active.variant.content.from, active.variant.content.to - 1) });
			}
			const changes: DocumentChange[] = [];
			transaction.changes.iterChanges(
				(from, to, _fromNew, _toNew, inserted) => {
					changes.push({ from, to, inserted: inserted.toString() });
				},
			);
			// Reject the whole edit, including its selection change, so a blocked
			// Backspace/Delete cannot move the caret out and close native editing.
			return changesRespectVariantBoundaries(parsed, spans, changes) ? transaction : [];
		}),
		decorationsField,
		ViewPlugin.fromClass(SectionVariantsViewPlugin),
		Prec.high(
			keymap.of([
				{
					key: 'Escape',
					run(view) {
						const active = view.state.field(editingField);
						if (!active) return false;
						const resolved = resolveEditingTarget(host, view.state, active);
						const anchor = resolved?.block.closing
							? blockSpan(
									view.state.doc,
									resolved.block.opening.from,
									resolved.block.closing.from,
								).to
							: Math.min(active.blockFrom, view.state.doc.length);
						view.dispatch({
							effects: editingTargetEffect.of(null),
							selection: { anchor },
						});
						return true;
					},
				},
			]),
		),
	];
}

function buildDecorations(
	host: SectionVariantsHost,
	state: EditorState,
	target: EditingTarget | null,
): { deco: DecorationSet; atomic: DecorationSet; frames: NativeFrameRange[] } {
	if (!state.field(editorLivePreviewField, false)) {
		return { deco: Decoration.none, atomic: Decoration.none, frames: [] };
	}
	const path = state.field(editorInfoField, false)?.file?.path;
	if (!path) return { deco: Decoration.none, atomic: Decoration.none, frames: [] };
	const source = state.doc.toString();
	const parsed = host.parse(source);
	const ranges: Range<Decoration>[] = [];
	const atomicRanges: Range<Decoration>[] = [];
	const frames: NativeFrameRange[] = [];
	for (const block of parsed.roots) {
		if (!block.valid || !block.closing) continue;
		decorateBlock(
			host,
			state.doc,
			path,
			source,
			block,
			target,
			ranges,
			atomicRanges,
			frames,
		);
	}
	return {
		deco: Decoration.set(ranges, true),
		atomic: Decoration.set(atomicRanges, true),
		frames,
	};
}

function decorateBlock(
	host: SectionVariantsHost,
	doc: EditorState['doc'],
	path: string,
	source: string,
	block: VariantBlock,
	target: EditingTarget | null,
	ranges: Range<Decoration>[],
	atomicRanges: Range<Decoration>[],
	frames: NativeFrameRange[],
): void {
	if (!block.closing) return;
	const state = host.store.resolve(path, block);
	if (state.view === 'columns') {
		const span = blockSpan(doc, block.opening.from, block.closing.from);
		addAtomicReplacement(
			ranges,
			atomicRanges,
			Decoration.replace({
				block: true,
				widget: new LiveBlockWidget(host, path, source, block, 'columns'),
			}).range(span.from, span.to),
		);
		return;
	}

	const activeVariant = block.variants.find(
					(variant) =>
						variant.normalizedLabel === normalizeLabel(state.selectedLabel),
				);
	if (!activeVariant?.closing) return;
	frames.push({ from: block.opening.from, to: block.closing.to });
	addAtomicReplacement(
		ranges,
		atomicRanges,
		Decoration.replace({
			block: true,
			widget: new LiveBlockWidget(
				host,
				path,
				source,
				block,
				'toolbar',
				activeVariant.label,
			),
		}).range(block.opening.from, activeVariant.content.from),
	);
	addAtomicReplacement(ranges, atomicRanges,
		Decoration.replace({ widget: new NativeEndWidget(block.opening.from) }).range(activeVariant.content.to, block.closing.to),
	);
	if (activeVariant.content.from !== activeVariant.content.to) {
		ranges.push(Decoration.line({ class: 'section-variants-native-boundary-line' }).range(doc.lineAt(activeVariant.content.to).from));
	}
	for (const child of activeVariant.children) {
		if (!child.valid || !child.closing) continue;
		decorateBlock(host, doc, path, source, child, target, ranges, atomicRanges, frames);
	}
}

class NativeEndWidget extends WidgetType {
	constructor(private readonly blockFrom: number) { super(); }
	eq(other: NativeEndWidget): boolean { return other.blockFrom === this.blockFrom; }
	toDOM(view: EditorView): HTMLElement {
		const end = view.dom.ownerDocument.createElement('span');
		end.className = 'section-variants-native-end';
		end.dataset.blockFrom = String(this.blockFrom);
		end.setAttribute('aria-hidden', 'true');
		return end;
	}
}

function addAtomicReplacement(
	ranges: Range<Decoration>[],
	atomicRanges: Range<Decoration>[],
	range: Range<Decoration>,
): void {
	ranges.push(range);
	atomicRanges.push(range);
}

function collectEditableSpans(
	host: SectionVariantsHost,
	path: string,
	source: string,
	blocks: readonly VariantBlock[],
	target: EditingTarget | null,
): EditableSpan[] {
	const spans: EditableSpan[] = [];
	for (const block of blocks) {
		if (!block.valid || !block.closing) continue;
		const state = host.store.resolve(path, block);
		const variant =
			state.view === 'columns'
				? editingPathVariant(block, target)
				: block.variants.find(
						(item) =>
							item.normalizedLabel === normalizeLabel(state.selectedLabel),
					);
		if (!variant?.closing) continue;
		spans.push(...editableSpansForVariant(variant, source));
		spans.push(
			...collectEditableSpans(host, path, source, variant.children, target),
		);
	}
	return spans;
}

function resolveEditingTarget(
	host: SectionVariantsHost,
	state: EditorState,
	target: EditingTarget,
): ResolvedEditingTarget | undefined {
	const path = state.field(editorInfoField, false)?.file?.path;
	if (!path) return undefined;
	const parsed = host.parse(state.doc.toString());
	const block = parsed.blocks.find(
		(candidate) =>
			candidate.valid &&
			candidate.closing &&
			candidate.opening.from === target.blockFrom,
	);
	if (!block) return undefined;
	const resolved = host.store.resolve(path, block);
	if (resolved.view !== 'columns') return undefined;
	const normalized = normalizeLabel(target.label);
	if (resolved.hiddenLabels.has(normalized)) return undefined;
	const variant = block.variants.find(
		(candidate) => candidate.normalizedLabel === normalized,
	);
	if (!variant?.closing) return undefined;
	for (let ancestor = block.parent; ancestor; ancestor = ancestor.parent) {
		if (!ancestor.valid || !ancestor.closing) return undefined;
		const pathVariant = editingPathVariant(ancestor, target);
		if (!pathVariant) return undefined;
		const ancestorState = host.store.resolve(path, ancestor);
		if (ancestorState.view === 'columns') {
			if (ancestorState.hiddenLabels.has(pathVariant.normalizedLabel)) return undefined;
		} else if (normalizeLabel(ancestorState.selectedLabel) !== pathVariant.normalizedLabel) {
			return undefined;
		}
	}
	return { path, parsed, block, variant };
}

function selectionTouchesRange(
	state: EditorState,
	from: number,
	to: number,
): boolean {
	return state.selection.ranges.some(
		(range) =>
			range.from <= to && range.to >= from,
	);
}

function sameTarget(
	left: EditingTarget | null,
	right: EditingTarget | null,
): boolean {
	if (!left || !right) return left === right;
	return (
		left.blockFrom === right.blockFrom &&
		normalizeLabel(left.label) === normalizeLabel(right.label)
	);
}

type LiveWidgetMode = 'toolbar' | 'columns';

interface LiveWidgetResources {
	widget: LiveBlockWidget;
	controls: { rebind(block: VariantBlock): void };
	panels: Map<string, HTMLElement>;
	component: Component;
	columnObserver?: ResizeObserver;
	headers: Map<string, VariantHeaderHandle>;
	nestedRenderers: VariantBlockRenderer[];
	uiSignature: string;
	panelContent: Map<string, string>;
	panelComponents: Map<string, Component>;
}

const liveWidgetResources = new WeakMap<HTMLElement, LiveWidgetResources>();

class LiveBlockWidget extends WidgetType {
	private readonly uiSignature: string;

	constructor(
		private readonly host: SectionVariantsHost,
		private readonly path: string,
		private readonly source: string,
		private readonly block: VariantBlock,
		private readonly mode: LiveWidgetMode,
		private readonly editingLabel?: string,
	) {
		super();
		const state = host.store.resolve(path, block);
		this.uiSignature = [
			mode,
			state.selectedLabel,
			state.view,
			block.attributes.name ?? '',
			String(state.differsFromAuthored),
			String(host.store.isFollowingGlobalState(path, block)),
			state.responsive,
			state.minWidth,
			state.widths ?? '',
			[...state.hiddenLabels].sort().join(','),
			block.variants.map((variant) => variant.label).join('\u0001'),
			editingLabel ?? '',
		].join('\u0000');
	}

	eq(): boolean {
		// updateDOM rebinds source offsets even when rendered content is unchanged.
		return false;
	}

	toDOM(view: EditorView): HTMLElement {
		const root = createOwnerDocumentDiv(view.dom);
		root.addClass(
			'section-variants-root',
			'section-variants-live-widget',
			`section-variants-live-${this.mode}`,
		);
		root.toggleClass('has-block-name', Boolean(this.block.attributes.name));
		root.dataset.blockKey = this.block.identityKey;
		root.dataset.blockFrom = String(this.block.opening.from);
		const controls = renderLiveToolbar(this.host, this.path, this.block, root, view);
		const component = new Component();
		component.load();
		const resources: LiveWidgetResources = {
			widget: this,
			controls,
			panels: new Map(),
			component,
			headers: new Map(),
			nestedRenderers: [],
			uiSignature: this.uiSignature,
			panelContent: new Map(),
			panelComponents: new Map(),
		};
		liveWidgetResources.set(root, resources);
		if (this.mode !== 'columns') {
			root.addClass('section-variants-native-header');
			root.dataset.editingLabel = this.editingLabel ?? '';
			if (this.block.attributes.name) {
				root.createDiv({
					cls: 'section-variants-native-block-name',
					text: this.block.attributes.name,
				});
			}
			return root;
		}

		const state = this.host.store.resolve(this.path, this.block);
		root.dataset.currentView = 'columns';
		const content = root.createDiv({
			cls: `section-variants-content section-variants-view-columns${this.block.attributes.name ? ' has-block-name' : ''}`,
		});
		if (this.block.attributes.name) {
			content.createDiv({
				cls: 'section-variants-block-name',
				text: this.block.attributes.name,
			});
		}
		content.dataset.responsive = state.responsive;
		content.style.setProperty('--section-variants-min-width', state.minWidth);
		const visibleIndexes = this.block.variants.flatMap((variant, index) =>
			state.hiddenLabels.has(variant.normalizedLabel) ? [] : [index],
		);
		const widths = visibleColumnWidths(
			state.widths,
			this.block.variants.length,
			visibleIndexes,
		);
		const visibleCount = visibleIndexes.length;
		for (const variant of this.block.variants) {
			if (state.hiddenLabels.has(variant.normalizedLabel)) continue;
			const panel = content.createDiv({ cls: 'section-variants-panel' });
			panel.dataset.label = variant.label;
			panel.dataset.blockFrom = String(this.block.opening.from);
			resources.panels.set(variant.normalizedLabel, panel);
			resources.headers.set(
				variant.normalizedLabel,
				createVariantHeader({
					parent: panel,
					source: this.source,
					variant,
					onHide: () => {
						this.host.store.toggleHidden(
							this.path,
							resources.widget.block,
							variant.label,
						);
					},
				}),
			);
			const body = panel.createDiv({ cls: 'section-variants-prose' });
			const panelComponent = component.addChild(new Component());
			resources.panelComponents.set(variant.normalizedLabel, panelComponent);
			resources.panelContent.set(variant.normalizedLabel, this.source.slice(variant.content.from, variant.content.to));
			void renderVariantPreview(
				this.host,
				this.path,
				this.source,
				variant,
				body,
				panelComponent,
				resources.nestedRenderers,
				(index, before, after) => {
					const source = view.state.doc.toString();
					const change = previewChange(source, this.host.parse(source), resources.widget.block, variant.normalizedLabel, index, before, after);
					const expected = view.state.changes(change).apply(view.state.doc).toString();
					view.dispatch({ changes: change, annotations: isolateNativeHistory.of('full') });
					if (view.state.doc.toString() !== expected) throw new Error('Preview edit rejected.');
				},
			);
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
				this.host.store.restoreColumns(this.path, resources.widget.block);
			});
		}
		resources.columnObserver = new ResizeObserver(() => {
			syncColumnGrid(content, widths, state.responsive, visibleCount);
			syncColumnSeparators(content);
		});
		resources.columnObserver.observe(content);
		syncColumnGrid(content, widths, state.responsive, visibleCount);
		syncColumnSeparators(content);
		return root;
	}

	updateDOM(dom: HTMLElement, view: EditorView): boolean {
		const resources = liveWidgetResources.get(dom);
		if (
			!resources ||
			resources.uiSignature !== this.uiSignature
		) {
			return false;
		}
		dom.dataset.blockKey = this.block.identityKey;
		dom.dataset.blockFrom = String(this.block.opening.from);
		resources.widget = this;
		resources.controls.rebind(this.block);
		resources.nestedRenderers = resources.nestedRenderers.filter(renderer => renderer.containerEl.isConnected);
		for (const variant of this.block.variants) {
			const panel = resources.panels.get(variant.normalizedLabel);
			if (panel) panel.dataset.blockFrom = String(this.block.opening.from);
			const text = this.source.slice(variant.content.from, variant.content.to);
			if (panel && !panel.querySelector('.section-variants-column-editor') && resources.panelContent.get(variant.normalizedLabel) !== text) {
				const body = panel.querySelector<HTMLElement>(':scope > .section-variants-prose');
				const previous = resources.panelComponents.get(variant.normalizedLabel);
				if (previous) resources.component.removeChild(previous);
				const component = resources.component.addChild(new Component());
				resources.panelComponents.set(variant.normalizedLabel, component);
				resources.panelContent.set(variant.normalizedLabel, text);
				if (body) {
					body.empty();
					void renderVariantPreview(this.host, this.path, this.source, variant, body, component, resources.nestedRenderers, (index, before, after) => {
						const source = view.state.doc.toString();
						const change = previewChange(source, this.host.parse(source), resources.widget.block, variant.normalizedLabel, index, before, after);
						const expected = view.state.changes(change).apply(view.state.doc).toString();
						view.dispatch({ changes: change, annotations: isolateNativeHistory.of('full') });
						if (view.state.doc.toString() !== expected) throw new Error('Preview edit rejected.');
					});
				}
			}
			resources.headers
				.get(variant.normalizedLabel)
				?.rebind(this.source, variant);
		}
		const parsed = this.host.parse(this.source);
		for (const renderer of resources.nestedRenderers) {
			if (renderer.containerEl.isConnected) renderer.rebind(this.source, parsed.blocks, true);
		}
		return true;
	}

	destroy(dom: HTMLElement): void {
		const resources = liveWidgetResources.get(dom);
		resources?.columnObserver?.disconnect();
		resources?.component.unload();
		liveWidgetResources.delete(dom);
	}

	ignoreEvent(): boolean {
		return true;
	}
}

function activateVariantFromPreview(
	host: SectionVariantsHost,
	view: EditorView,
	event: MouseEvent,
	target: PreviewTarget,
): void {
	const source = view.state.doc.toString();
	const parsed = host.parse(source);
	let block = parsed.blocks.find(
		(candidate) => candidate.valid && candidate.opening.from === target.blockFrom,
	);
	let variant = block?.variants.find(
		(candidate) => candidate.normalizedLabel === normalizeLabel(target.label),
	);
	const path = view.state.field(editorInfoField, false)?.file?.path;
	if (!path || view.state.readOnly) return;
	// A nested Toggle preview needs its containing Columns variant exposed.
	while (block && host.store.resolve(path, block).view !== 'columns') {
		block = block.parent;
		variant = block ? editingPathVariant(block, target) : undefined;
	}
	if (!block || !variant?.closing) return;
	if (!resolveEditingTarget(host, view.state, { blockFrom: block.opening.from, label: variant.label })) return;
	event.preventDefault();
	event.stopPropagation();
	activationCoords.set(view, { x: event.clientX, y: event.clientY });
	view.dispatch({
		effects: editingTargetEffect.of({
			blockFrom: block.opening.from,
			label: variant.label,
		}),
		selection: { anchor: variant.content.from },
	});
}

function renderLiveToolbar(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	parent: HTMLElement,
	view: EditorView,
	showLabels = true,
): { rebind(block: VariantBlock): void } {
	const state = host.store.resolve(path, block);
	const toolbar = parent.createDiv({ cls: 'section-variants-toolbar' });
	toolbar.setAttribute('role', 'toolbar');
	toolbar.setAttribute('aria-label', 'Section variants in live preview');
	const controls = createBlockControls({
		host,
		path,
		block,
		parent: toolbar,
		mode: state.view,
		showLabels,
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
	return { rebind(next) { block = next; controls.rebind(next); } };
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

async function renderVariantPreview(
	host: SectionVariantsHost,
	path: string,
	source: string,
	variant: VariantSection,
	target: HTMLElement,
	component: Component,
	nestedRenderers: VariantBlockRenderer[],
	write: (index: number, ...change: Parameters<PreviewEdit>) => ReturnType<PreviewEdit>,
): Promise<void> {
	let cursor = variant.content.from;
	let index = 0;
	for (const child of [...variant.children].sort(
		(left, right) => left.range.from - right.range.from,
	)) {
		if (child.range.from > cursor) {
			const fragmentIndex = index;
			await renderNativePreview(
				host.app,
				source.slice(cursor, child.range.from),
				target,
				path,
				component,
				(before, after) => write(fragmentIndex, before, after),
			);
		}
		const nested = target.createDiv({ cls: 'section-variants-nested' });
		const renderer = new VariantBlockRenderer(
			host,
			nested,
			path,
			source,
			child,
		);
		nestedRenderers.push(renderer);
		component.addChild(renderer);
		cursor = child.range.to;
		index++;
	}
	if (cursor < variant.content.to) {
		await renderNativePreview(
			host.app,
			source.slice(cursor, variant.content.to),
			target,
			path,
			component,
			(before, after) => write(index, before, after),
		);
	}
}

function isInteractivePreviewTarget(target: Element, panel: HTMLElement): boolean {
	// Stop at the preview boundary: the outer native editor is contenteditable.
	for (let element: Element | null = target; element && element !== panel; element = element.parentElement) {
		if (element.matches('a, button, input, textarea, select, option, [contenteditable="true"], [role="button"], .clickable-icon, .collapse-indicator, .callout.is-collapsible > .callout-title, .task-list-item-checkbox, .internal-embed, .markdown-embed, audio, video, iframe, .section-variants-toolbar')) return true;
	}
	return false;
}

function createOwnerDocumentDiv(root: HTMLElement): HTMLDivElement {
	const ownerWindow = root.ownerDocument.win as Window & {
		createDiv(): HTMLDivElement;
	};
	return ownerWindow.createDiv();
}
