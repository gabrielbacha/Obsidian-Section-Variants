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
    window.lastNativeView=this.cm;
    if(window.nativeFailureStage==='constructor')throw new Error('Injected constructor failure');
  }
  load(){super.load();if(window.nativeFailureStage==='load')throw new Error('Injected load failure');}
  buildLocalExtensions() { return [keymap.of(defaultKeymap)]; }
  getScroll() { return 0; }
  set(source) {
    if(window.nativeFailureStage==='set')throw new Error('Injected set failure');
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
    if(window.renderDelay)await window.renderDelay;
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

export class TFile {constructor(path){this.path=path;}get basename(){return this.path.replace(/.*\//,'').replace(/\.md$/,'');}}
export function normalizePath(path){return path.replaceAll('\\','/').replace(/^\.\//,'');}
export class Modal {constructor(app){this.app=app;this.contentEl=document.createElement('div');this.contentEl.className='modal-content';}setTitle(title){this.title=title;}open(){document.body.append(this.contentEl);this.onOpen?.();}close(){this.onClose?.();this.contentEl.remove();}}
export class AbstractInputSuggest {constructor(app,input){this.app=app;this.inputEl=input;}open(){}close(){}setValue(value){this.inputEl.value=value;this.inputEl.dispatchEvent(new Event('input',{bubbles:true}));}}
export class Setting {constructor(parent){this.settingEl=parent.createDiv({cls:'setting-item'});this.controlEl=this.settingEl.createDiv();}setName(name){this.settingEl.dataset.name=name;return this;}setDesc(){return this;}addText(callback){const inputEl=this.controlEl.createEl('input');const component={inputEl,setValue(value){inputEl.value=value;return this;},onChange(fn){inputEl.addEventListener('input',()=>fn(inputEl.value));return this;}};callback(component);return this;}addDropdown(callback){const selectEl=this.controlEl.createEl('select');const component={selectEl,addOption(value,text){const option=selectEl.createEl('option',{text});option.value=value;return this;},addOptions(values){for(const [value,text]of Object.entries(values))this.addOption(value,text);return this;},setValue(value){selectEl.value=value;return this;},onChange(fn){selectEl.addEventListener('change',()=>fn(selectEl.value));return this;}};callback(component);return this;}addButton(callback){const buttonEl=this.controlEl.createEl('button');const component={buttonEl,setButtonText(text){buttonEl.textContent=text;return this;},setIcon(){return this;},setTooltip(text){buttonEl.title=text;return this;},setDisabled(value){buttonEl.disabled=value;return this;},setCta(){return this;},setClass(name){buttonEl.classList.add(name);return this;},onClick(fn){buttonEl.addEventListener('click',fn);return this;}};callback(component);return this;}addExtraButton(callback){return this.addButton(callback);}}
export class Menu {addItem(callback){callback({setTitle(){return this;},setIcon(){return this;},onClick(){return this;}});return this;}showAtMouseEvent(){}}
window.createEl=(tag,options)=>{const parent=document.createElement('div');return parent.createEl(tag,options);};
