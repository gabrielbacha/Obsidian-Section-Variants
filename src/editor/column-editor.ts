import { Annotation, EditorSelection, Extension, Prec, StateEffect, Transaction, TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { App, Component, Editor, editorInfoField, MarkdownFileInfo } from 'obsidian';
import { VariantSection } from '../core/types';
import { isolateNativeHistory } from './history';

/** Internal host marker: embedded editors must never enter the note refresh registry. */
export const columnEditorOwner = Symbol('section-variants-column-editor');
export const columnTransaction = Annotation.define<boolean>();

interface NativeEditor extends Component {
	cm: EditorView;
	editor: Editor;
	sourceMode: boolean;
	set(value: string, clear: boolean): void;
	destroy(): void;
	buildLocalExtensions(): Extension[];
}

interface ColumnOwner extends MarkdownFileInfo {
	[columnEditorOwner]: true;
	containerEl: HTMLElement;
	syncScroll(): void;
	getMode(): 'source';
}

type NativeEditorConstructor = new (app: App, parent: HTMLElement, owner: ColumnOwner) => NativeEditor;

/**
 * Use Obsidian's Markdown editor, not a copy of another editor's state. The
 * Markdown pane and Obsidian's embedded editor share this base implementation.
 * Keep this undocumented integration confined here and fail without changing
 * the note if the host no longer supplies the expected interface.
 */
function nativeEditorConstructor(outer: EditorView): NativeEditorConstructor {
	const info: (MarkdownFileInfo & { editMode?: NativeEditor }) | undefined = outer.state.field(editorInfoField, false);
	const mode = info?.editMode;
	if (!mode) throw new Error('Obsidian Markdown editor is unavailable in this pane.');
	let prototype: object | null = Object.getPrototypeOf(mode) as object;
	while (prototype) {
		if (Object.prototype.hasOwnProperty.call(prototype, 'buildLocalExtensions') &&
			Object.prototype.hasOwnProperty.call(prototype, 'getScroll')) {
			return prototype.constructor as NativeEditorConstructor;
		}
		prototype = Object.getPrototypeOf(prototype) as object | null;
	}
	throw new Error('This Obsidian version does not expose a compatible embedded Markdown editor.');
}

export class ColumnEditor {
	private readonly native: NativeEditor;
	private readonly owner: ColumnOwner;
	private variant: VariantSection;
	private destroyed = false;
	private forwarding = false;
	private syncing = false;
	readonly mount: HTMLElement;

	constructor(
		private readonly app: App,
		private readonly outer: EditorView,
		parent: HTMLElement,
		variant: VariantSection,
		onExit: () => void,
	) {
		const Native = nativeEditorConstructor(outer);
		this.variant = variant;
		this.mount = parent.createDiv({ cls: 'section-variants-column-editor' });
		this.owner = {
			app, file: outer.state.field(editorInfoField).file,
			hoverPopover: null, containerEl: this.mount,
			[columnEditorOwner]: true,
			syncScroll: () => {}, getMode: () => 'source',
		};
		const history = (action: 'undo' | 'redo'): boolean => {
			outer.state.field(editorInfoField).editor?.[action]();
			return true;
		};
		class VariantMarkdownEditor extends Native {
			buildLocalExtensions(): Extension[] {
				return [...super.buildLocalExtensions(), Prec.highest(keymap.of([
					{ key: 'Mod-z', run: () => history('undo') },
					{ key: 'Mod-Shift-z', run: () => history('redo') },
					{ key: 'Mod-y', run: () => history('redo') },
				]))];
			}
		}
		this.native = new VariantMarkdownEditor(app, this.mount, this.owner);
		this.owner.editor = this.native.editor;
		this.native.editor.undo = () => { history('undo'); };
		this.native.editor.redo = () => { history('redo'); };
		// Nested variants can obtain the same native factory without copying state.
		Object.assign(this.owner, { editMode: this.native });
		this.native.sourceMode = false;
		this.native.load();
		try {
			this.native.set(this.text(), true);
		} catch (error) {
			this.destroy();
			throw error;
		}
		// Handle before Obsidian's editor keymaps, which also consume Escape.
		const escape = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape' || event.isComposing) return;
			if ((event.target as HTMLElement | null)?.closest('.section-variants-column-editor') !== this.mount) return;
			if (this.mount.ownerDocument.querySelector('.suggestion-container')) return;
			event.preventDefault();
			event.stopPropagation();
			queueMicrotask(onExit);
		};
		this.mount.addEventListener('keydown', escape, true);
		this.native.register(() => this.mount.removeEventListener('keydown', escape, true));
		const view = this.native.cm;
		view.contentDOM.setAttribute('aria-label', `Edit ${variant.label} Markdown`);
		view.setRoot(parent.ownerDocument);
		// Forward before displaying a change. The original note is authoritative,
		// and owns undo history, including changes made by commands and paste.
		view.dispatch = (...specs) => {
			const first = specs[0];
			const transactions: readonly Transaction[] = first instanceof Transaction ? [first]
				: Array.isArray(first) ? first : [view.state.update(...specs as TransactionSpec[])];
			for (const transaction of transactions) {
				if (this.destroyed) return;
				if (this.syncing) { view.update([transaction]); continue; }
				this.forwarding = true;
				try {
					if (transaction.docChanged) {
						const offset = this.variant.content.from;
						const changes: { from: number; to: number; insert: string }[] = [];
						transaction.changes.iterChanges((from, to, _a, _b, insert) => {
							changes.push({ from: offset + from, to: offset + to, insert: insert.toString() });
						});
						if (this.variant.content.from === this.variant.content.to && transaction.newDoc.length && changes.length) {
							changes[changes.length - 1]!.insert += '\n';
						}
						const expected = outer.state.changes(changes).apply(outer.state.doc).toString();
						outer.dispatch({ changes,
							selection: EditorSelection.create(transaction.newSelection.ranges.map(r => EditorSelection.range(offset + r.anchor, offset + r.head)), transaction.newSelection.mainIndex),
							userEvent: transaction.annotation(Transaction.userEvent) ?? 'input',
							annotations: [columnTransaction.of(true), ...(transaction.annotation(isolateNativeHistory) ? [isolateNativeHistory.of(transaction.annotation(isolateNativeHistory)!)] : [])],
						});
						// The outer boundary filter may reject a transaction atomically.
						if (outer.state.doc.toString() !== expected) return;
						this.variant = { ...this.variant, content: { ...this.variant.content, to: offset + transaction.newDoc.length + 1 } };
					}
					view.update([transaction]);
				} finally { this.forwarding = false; }
			}
		};
	}

	refresh(effect: StateEffect<unknown>): void {
		if (!this.destroyed) this.native.cm.dispatch({ effects: effect });
	}

	focus(coords?: { x: number; y: number }): void {
		const view = this.native.cm;
		const anchor = coords ? view.posAtCoords(coords) ?? 0 : 0;
		view.dispatch({ selection: { anchor } });
		view.contentDOM.focus({ preventScroll: true });
	}

	rebind(variant: VariantSection): void {
		this.variant = variant;
		if (this.forwarding || this.destroyed) return;
		const view = this.native.cm;
		const next = this.text();
		const previous = view.state.doc.toString();
		if (next === previous) return;
		// Minimal replacement preserves the cursor and composition on external edits.
		let from = 0;
		while (from < next.length && from < previous.length && next[from] === previous[from]) from++;
		let suffix = 0;
		while (suffix < next.length - from && suffix < previous.length - from && next[next.length - suffix - 1] === previous[previous.length - suffix - 1]) suffix++;
		this.syncing = true;
		try {
			view.dispatch({ changes: { from, to: previous.length - suffix, insert: next.slice(from, next.length - suffix) }, annotations: Transaction.addToHistory.of(false) });
		} finally { this.syncing = false; }
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.native.destroy();
		this.native.unload();
		if (this.app.workspace.activeEditor === this.owner) this.app.workspace.activeEditor = this.outer.state.field(editorInfoField);
		this.mount.remove();
	}

	private text(): string {
		const { from, to } = this.variant.content;
		return this.outer.state.doc.sliceString(from, to).replace(/\n$/, '');
	}
}
