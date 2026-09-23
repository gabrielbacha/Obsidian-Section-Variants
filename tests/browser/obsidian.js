import { EditorState, StateField } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';

export const editorInfoField = StateField.define({ create: () => ({ file: { path: 'test.md' }, editor: {} }), update: v => v });
export const editorLivePreviewField = StateField.define({ create: () => true, update: v => v });
export class Component {
  children = [];
  cleanup = [];
  register(fn) { this.cleanup.push(fn); }
  registerEvent() {}
  load() { this.loaded = true; this.onload?.(); }
  unload() { this.loaded = false; this.onunload?.(); this.children.forEach(c => c.unload()); this.children = []; this.cleanup.forEach(fn => fn()); this.cleanup = []; }
  addChild(c) { this.children.push(c); if (this.loaded) c.load(); return c; }
  removeChild(c) { c.unload(); this.children = this.children.filter(x => x !== c); return c; }
}
export class MarkdownRenderChild extends Component { constructor(el) { super(); this.containerEl = el; } }
export class MarkdownView {}
// Host-contract double only. The real Obsidian runtime is verified separately.
export class TestNativeEditor extends Component {
  constructor(app, parent, owner) {
    super(); this.app = app; this.owner = owner;
    this.editorEl = parent.createDiv({ cls: 'markdown-source-view mod-cm6 is-live-preview' });
    this.cm = new EditorView({ parent: this.editorEl });
    this.editor = { undo() {}, redo() {} };
  }
  buildLocalExtensions() { return [keymap.of(defaultKeymap)]; }
  getScroll() { return 0; }
  set(source) {
    this.cm.setState(EditorState.create({ doc: source, extensions: [
      editorInfoField.init(() => this.owner), editorLivePreviewField,
      this.buildLocalExtensions(), window.nativeExtensions(),
      EditorView.domEventHandlers({ focus: () => { this.app.workspace.activeEditor = this.owner; } }),
    ] }));
  }
  destroy() { this.cm.destroy(); this.editorEl.remove(); }
}
export class TestPaneEditor extends TestNativeEditor {}
export class Notice { constructor(message) { window.notices.push(message); } }
export function setIcon(el, icon) { el.dataset.icon = icon; }
export function setTooltip(el, text) { el.title = text; }
export class MarkdownRenderer extends Component {
  constructor(app, mount) {
    super();
    if (window.unsupportedPreview) throw new Error('Unsupported preview fixture');
    this.app = app;
    const previewEl = mount.createDiv({ cls: 'markdown-preview-view markdown-rendered' });
    const sizerEl = previewEl.createDiv({ cls: 'markdown-preview-sizer markdown-preview-section' });
    this.renderer = {
      previewEl, sizerEl, queued: null,
      set: source => { this.source = source; sizerEl.empty(); MarkdownRenderer.render(app, source, sizerEl); },
      rerender: () => this.renderer.set(this.source), onResize() {}, queueRender() {}, addFooter() {},
    };
    mount.previewInstance = this;
  }
  postProcess() {}
  static async render(_app, source, target) {
    window.renderCount++;
    const p = target.createEl('p', { text: source.trim() });
    if (source.includes('[link]')) p.createEl('a', { text: 'link', attr: { href: '#example' } });
    if (source.includes('[ ]')) p.createEl('input', { type: 'checkbox' });
  }
}

window.notices = [];
window.renderCount = 0;
window.activeDocument = document;
Object.defineProperty(Document.prototype, 'win', { get() { return this.defaultView; } });
Node.prototype.instanceOf = function(type) { return this instanceof type; };
Element.prototype.addClass = function(...names) { this.classList.add(...names); };
Element.prototype.removeClass = function(...names) { this.classList.remove(...names); };
Element.prototype.hasClass = function(name) { return this.classList.contains(name); };
Element.prototype.toggleClass = function(name, on) { this.classList.toggle(name, on); };
Element.prototype.empty = function() { this.replaceChildren(); };
Element.prototype.setText = function(text) { this.textContent = text; };
Element.prototype.setAttr = function(name, value) { this.setAttribute(name, value); };
Element.prototype.createEl = function(tag, options = {}) {
  if (typeof options === 'string') options = { cls: options };
  const el = this.ownerDocument.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  if (options.type) el.type = options.type;
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
  this.append(el);
  return el;
};
Element.prototype.createDiv = function(options) { return this.createEl('div', options); };
Element.prototype.createSpan = function(options) { return this.createEl('span', options); };
window.createDiv = options => { const parent = document.createElement('div'); return parent.createDiv(options); };
