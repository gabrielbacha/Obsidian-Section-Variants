import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, Decoration, WidgetType } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, undo, redo, undoDepth } from '@codemirror/commands';
import { editorInfoField, editorLivePreviewField, TestPaneEditor } from 'obsidian';
import { createLivePreviewExtension, refreshLivePreviewEditors } from '../../src/editor/live-preview';
import { parseNote } from '../../src/core/parser';
import { StateStore } from '../../src/state/store';

const store = new StateStore({ loadData: async () => null, saveData: async () => {} });
const calls = [];
const host = {
  app: { workspace: { getLeavesOfType: () => [], on: () => ({}) }, vault: { getFileByPath: () => ({ path: 'test.md' }), getConfig: () => false, on: () => ({}) } }, store, parse: parseNote,
  ensurePersistentIdentity: async (_path, block) => block,
  openAddVariant: (_path, block) => calls.push(block.opening.from),
  refreshAllViews: refreshLivePreviewEditors,
};
store.subscribe(() => refreshLivePreviewEditors());
window.nativeExtensions = () => createLivePreviewExtension(host);
window.h = {
  views: [], calls, store,
  create(source) {
    const parent = document.body.createDiv({ cls: 'test-pane' });
    const view = new EditorView({ parent, state: EditorState.create({ doc: source, extensions: [
      editorInfoField.init(() => ({ file: { path: 'test.md' }, getViewType: () => 'markdown', editMode: Object.create(TestPaneEditor.prototype), editor: {
        undo: () => undo(view), redo: () => redo(view),
      } })), editorLivePreviewField, history(), keymap.of([...defaultKeymap, ...historyKeymap]), createLivePreviewExtension(host),
    ] }) });
    this.views.push(view);
  },
  snapshot(index = 0) {
    const view = this.views[index];
    return { source: view.state.doc.toString(), anchor: view.state.selection.main.anchor, focus: view.dom.contains(document.activeElement), undoDepth: undoDepth(view.state),
      editingLabels: [...view.dom.querySelectorAll('.section-variants-panel.is-editing')].map(el => el.dataset.editingLabel),
      blocks: parseNote(view.state.doc.toString()).blocks.map(b => ({ from: b.opening.from, to: b.range.to, valid: b.valid, variants: b.variants.map(v => ({ label: v.label, from: v.content.from, to: v.content.to })) })),
    };
  },
  edit(from, to, insert, userEvent = 'input', index = 0) { this.views[index].dispatch({ changes: { from, to, insert }, userEvent }); },
  select(anchor, head = anchor, index = 0) { this.views[index].dispatch({ selection: { anchor, head } }); },
  hide(blockIndex, label) { const b = parseNote(this.views[0].state.doc.toString()).blocks[blockIndex]; store.toggleHidden('test.md', b, label); },
  undo() { return undo(this.views[0]); }, redo() { return redo(this.views[0]); },
  columnView() { return EditorView.findFromDOM(document.querySelector('.section-variants-column-editor .cm-content')); },
  columnSelect(anchor) { this.columnView().dispatch({ selection: { anchor } }); },
  rejectColumnEdits() { this.views[0].dispatch({ effects: StateEffect.appendConfig.of(EditorState.transactionFilter.of(tr => tr.docChanged ? [] : tr)) }); },
  installBlockWidget(from, to) {
    class Block extends WidgetType {
      toDOM() { const el = document.createElement('div'); el.className = 'test-native-block'; el.style.height = '180px'; el.textContent = 'Native block widget'; return el; }
    }
    const field = StateField.define({
      create: () => Decoration.set([Decoration.replace({ block: true, widget: new Block() }).range(from, to)]),
      update: (value, tr) => value.map(tr.changes),
      provide: f => EditorView.decorations.from(f),
    });
    this.views[0].dispatch({ effects: StateEffect.appendConfig.of(field) });
  },
};
