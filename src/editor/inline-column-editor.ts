import {
	EditorSelection,
	EditorState,
	Prec,
	Transaction,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { Component, editorInfoField } from 'obsidian';
import { VariantSection } from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { VariantBlockRenderer } from '../ui/block-renderer';
import { EditableSpan, editableSpansForVariant } from './edit-boundaries';
import { deriveFragmentState } from './fragment-state';
import {
	mapInlineChanges,
	mapInlineSelection,
	RelativeChange,
	selectionWithinInlineSpan,
} from './inline-changes';

interface Island {
	span: EditableSpan;
	view: EditorView;
}

export interface InlineColumnEditorOptions {
	host: SectionVariantsHost;
	path: string;
	source: string;
	variant: VariantSection;
	outerView: EditorView;
	parent: HTMLElement;
	component: Component;
	onExit: () => void;
}

/**
 * Owns the small source editors used by an active column. Each editor maps to
 * one prose island; valid nested variant blocks remain rendered between them.
 */
export class InlineColumnEditor {
	private source: string;
	private variant: VariantSection;
	private outerView: EditorView;
	private readonly islands: Island[] = [];
	private readonly structure: string;
	private readonly nestedContent: string;
	private destroyed = false;
	private rebinding = false;
	private forwarding = false;

	constructor(private readonly options: InlineColumnEditorOptions) {
		this.source = options.source;
		this.variant = options.variant;
		this.outerView = options.outerView;
		this.structure = structureSignature(options.variant);
		this.nestedContent = nestedContentSignature(options.variant, options.source);
		this.render(options.parent, options.component);
	}

	focus(): void {
		this.islands[0]?.view.focus();
	}

	rebind(source: string, variant: VariantSection, outerView: EditorView): boolean {
		if (
			this.destroyed ||
			structureSignature(variant) !== this.structure ||
			nestedContentSignature(variant, source) !== this.nestedContent
		) {
			return false;
		}
		const spans = editableSpansForVariant(variant, source);
		if (spans.length !== this.islands.length) return false;

		this.source = source;
		this.variant = variant;
		this.outerView = outerView;
		spans.forEach((span, index) => {
			const island = this.islands[index];
			if (!island) return;
			island.span = span;
			const next = source.slice(span.from, span.to);
			const previous = island.view.state.doc.toString();
			if (this.forwarding) return;
			if (next === previous) return;
			const selection = island.view.state.selection;
			const ownerSelection = island.view.hasFocus
				? selectionWithinInlineSpan(span, outerView.state.selection.ranges)
				: undefined;
			const mappedSelection = EditorSelection.create(
				ownerSelection?.map((range) =>
					EditorSelection.range(range.anchor, range.head),
				) ??
					selection.ranges.map((range) =>
						EditorSelection.range(
							mapOffsetThroughReplacement(previous, next, range.anchor),
							mapOffsetThroughReplacement(previous, next, range.head),
						),
					),
				ownerSelection ? outerView.state.selection.mainIndex : selection.mainIndex,
			);
			this.rebinding = true;
			try {
				island.view.dispatch({
					changes: { from: 0, to: island.view.state.doc.length, insert: next },
					selection: mappedSelection,
				});
			} finally {
				this.rebinding = false;
			}
		});
		return true;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const island of this.islands) island.view.destroy();
		this.islands.length = 0;
	}

	private render(parent: HTMLElement, component: Component): void {
		const spans = editableSpansForVariant(this.variant, this.source);
		const children = [...this.variant.children]
			.filter((child) => child.valid && child.closing)
			.sort((left, right) => left.range.from - right.range.from);
		const items = [
			...spans.map((span, index) => ({ from: span.from, kind: 'span' as const, span, index })),
			...children.map((child) => ({ from: child.range.from, kind: 'child' as const, child })),
		].sort((left, right) => left.from - right.from || (left.kind === 'span' ? -1 : 1));

		for (const item of items) {
			if (item.kind === 'child') {
				const nested = parent.createDiv({ cls: 'section-variants-nested' });
				component.addChild(
					new VariantBlockRenderer(
						this.options.host,
						nested,
						this.options.path,
						this.source,
						item.child,
					),
				);
				continue;
			}
			const mount = parent.createDiv({ cls: 'section-variants-inline-editor' });
			let island: Island;
			const view = this.createEditor(mount, item.span, () => island);
			island = { span: item.span, view };
			this.islands.push(island);
		}
	}

	private createEditor(
		parent: HTMLElement,
		initialSpan: EditableSpan,
		getIsland: () => Island,
	): EditorView {
		const markdown = this.source.slice(initialSpan.from, initialSpan.to);
		const child = new EditorView({
			parent,
			state: this.createLivePreviewState(markdown),
			dispatchTransactions: (transactions, view) => {
				view.update(transactions);
				if (this.destroyed || this.rebinding) return;
				const island = getIsland();
				this.forwarding = true;
				try {
					for (const transaction of transactions) {
						if (transaction.docChanged) {
							this.forwardChanges(island, transaction);
						} else if (transaction.selection) {
							this.mirrorSelection(island, transaction.state.selection);
						}
					}
				} finally {
					this.forwarding = false;
				}
			},
		});
		child.dom.addEventListener('focusin', () => {
			if (this.destroyed || this.rebinding) return;
			this.mirrorSelection(getIsland(), child.state.selection);
		});
		return child;
	}

	/**
	 * Derive the fragment from the owning editor state instead of constructing a
	 * bare CodeMirror instance. This retains Obsidian's current Markdown language,
	 * Live Preview decorations, theme compartments, and accessibility behavior.
	 */
	private createLivePreviewState(markdown: string): EditorState {
		return deriveFragmentState(this.outerView.state, markdown, [
			EditorState.allowMultipleSelections.of(true),
			EditorView.contentAttributes.of({
				'aria-label': `Edit ${this.variant.label} Markdown`,
				spellcheck: 'true',
			}),
			Prec.highest(
				keymap.of([
					{
						key: 'Escape',
						run: () => {
							this.options.onExit();
							this.outerView.focus();
							return true;
						},
					},
					{
						key: 'Mod-z',
						run: () => this.runOuterHistory('undo'),
					},
					{
						key: 'Mod-Shift-z',
						run: () => this.runOuterHistory('redo'),
					},
					{
						key: 'Mod-y',
						run: () => this.runOuterHistory('redo'),
					},
				]),
			),
		]);
	}

	private forwardChanges(island: Island, transaction: Transaction): void {
		const relative: RelativeChange[] = [];
		transaction.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => {
			relative.push({
				from,
				to,
				inserted: inserted.toString(),
			});
		});
		const mapped = mapInlineChanges(island.span, relative);
		if (!mapped) return;
		const userEvent = transaction.annotation(Transaction.userEvent) ?? 'input';
		const selection = this.mapSelection(island, transaction.state.selection);
		this.outerView.dispatch({
			changes: mapped.map((change) => ({
				from: change.from,
				to: change.to,
				insert: change.inserted ?? '',
			})),
			selection,
			annotations: Transaction.userEvent.of(userEvent),
		});
	}

	private mirrorSelection(island: Island, selection: EditorSelection): void {
		const mapped = this.mapSelection(island, selection);
		if (this.outerView.state.selection.eq(mapped)) return;
		this.outerView.dispatch({ selection: mapped });
	}

	private mapSelection(
		island: Island,
		selection: EditorSelection,
	): EditorSelection {
		const mapped = mapInlineSelection(island.span, selection.ranges);
		return EditorSelection.create(
			mapped.map((range) => EditorSelection.range(range.anchor, range.head)),
			selection.mainIndex,
		);
	}

	private runOuterHistory(action: 'undo' | 'redo'): boolean {
		const editor = this.outerView.state.field(editorInfoField, false)?.editor;
		if (!editor) return false;
		editor[action]();
		return true;
	}
}

function structureSignature(variant: VariantSection): string {
	return [
		variant.normalizedLabel,
		...variant.children
			.filter((child) => child.valid && child.closing)
			.map((child) => `${child.identityKey}:${child.variants.map((item) => item.normalizedLabel).join(',')}`),
	].join('\u0000');
}

function nestedContentSignature(variant: VariantSection, source: string): string {
	return variant.children
		.filter((child) => child.valid && child.closing)
		.map((child) => source.slice(child.range.from, child.range.to))
		.join('\u0000');
}

function mapOffsetThroughReplacement(
	previous: string,
	next: string,
	offset: number,
): number {
	let prefix = 0;
	while (
		prefix < previous.length &&
		prefix < next.length &&
		previous.charCodeAt(prefix) === next.charCodeAt(prefix)
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < previous.length - prefix &&
		suffix < next.length - prefix &&
		previous.charCodeAt(previous.length - suffix - 1) ===
			next.charCodeAt(next.length - suffix - 1)
	) {
		suffix += 1;
	}
	if (offset <= prefix) return offset;
	if (offset >= previous.length - suffix) {
		return Math.max(prefix, next.length - (previous.length - offset));
	}
	return Math.min(next.length - suffix, prefix);
}
