import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let bundle;
const SOURCE = 'Before\n:::: {.variants #one view="columns"}\n::: A\nAlpha\n:::\n::: B\nBeta [link] [ ]\n:::\n::::\nAfter';
test.beforeAll(async () => {
  // Obsidian supplies one shared CodeMirror state module to every extension.
  const result = await build({ entryPoints: ['tests/browser/harness.js'], bundle: true, write: false, format: 'iife', alias: { obsidian: path.resolve('tests/browser/obsidian.js'), '@codemirror/state': path.resolve('node_modules/@codemirror/state/dist/index.js') } });
  bundle = result.outputFiles[0].text;
});
test.beforeEach(async ({ page,context }) => {
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:','about:'].includes(url.protocol))return route.continue();return route.abort('blockedbyclient');});
  await page.setContent('<style>:root{--size-2-1:2px;--size-2-2:4px;--size-2-3:6px;--size-4-3:12px;--size-4-4:16px}.test-pane{width:1000px;margin:20px}.cm-content{min-height:200px}p{min-height:24px}</style>');
  await page.addStyleTag({ content: readFileSync('styles.css', 'utf8') });
  await page.addScriptTag({ content: bundle });
});
const create = (page, source = SOURCE) => page.evaluate(s => window.h.create(s), source);
const snapshot = page => page.evaluate(() => window.h.snapshot());
const panel = (page, label) => page.locator(`.section-variants-panel[data-label="${label}"]`).first();

test('native preview owns its wrappers and rebinds renderer edits without losing undo', async ({ page }) => {
  await create(page);
  await expect(panel(page, 'B').locator('.section-variants-preview.cm-html-embed > .markdown-preview-view.markdown-rendered > .markdown-preview-section')).toHaveCount(1);
  await page.evaluate(() => { window.previewBefore = document.querySelector('.section-variants-panel[data-label="B"] .section-variants-preview'); window.h.edit(0, 0, 'Prefix\n'); });
  await page.evaluate(() => window.previewBefore.previewInstance.edit('Beta changed [link] [ ]\n'));
  await expect.poll(async () => (await snapshot(page)).source).toBe('Prefix\n' + SOURCE.replace('Beta', 'Beta changed'));
  expect(await page.evaluate(() => window.previewBefore.isConnected)).toBe(false);
  await page.evaluate(() => window.h.undo());
  expect((await snapshot(page)).source).toBe('Prefix\n' + SOURCE);
});

test('unloaded and stale native preview callbacks cannot overwrite the note', async ({ page }) => {
  await create(page);
  await page.evaluate(() => {
    window.oldPreview = document.querySelector('.section-variants-panel[data-label="B"] .section-variants-preview').previewInstance;
    const source = window.h.snapshot().source;
    const from = source.indexOf('Beta');
    window.h.views[0].dispatch({ changes: { from, to: from + 4, insert: 'New text' } });
    window.oldPreview.edit('Stale text\n');
  });
  expect((await snapshot(page)).source).toBe(SOURCE.replace('Beta', 'New text'));
});

test('native preview instances stay mounted while another column is typed into', async ({ page }) => {
  await create(page);
  await page.evaluate(() => { window.previewBefore = document.querySelector('.section-variants-panel[data-label="B"] .section-variants-preview'); window.rendersBefore = window.renderCount; });
  await panel(page, 'A').locator('p').click();
  await page.keyboard.type('Typing');
  expect(await page.evaluate(() => window.previewBefore === document.querySelector('.section-variants-panel[data-label="B"] .section-variants-preview'))).toBe(true);
  expect(await page.evaluate(() => window.renderCount)).toBe(await page.evaluate(() => window.rendersBefore));
});

test('unsupported native preview stays readable without unsafe checkbox edits', async ({ page }) => {
  await page.evaluate(() => { window.unsupportedPreview = true; });
  await create(page);
  await expect(panel(page, 'B').locator('p')).toBeVisible();
  await expect(panel(page, 'B').locator('input')).toBeDisabled();
  expect((await snapshot(page)).source).toBe(SOURCE);
  await panel(page, 'A').locator('p').click();
  await expect(panel(page, 'A').locator('.section-variants-column-editor')).toBeVisible();
});

test('validated plugin mutations can change hidden content without weakening user boundaries', async ({ page }) => {
  await create(page);
  const from = SOURCE.indexOf('Beta');
  await page.evaluate(from => window.h.edit(from, from + 4, 'User'), from);
  expect((await snapshot(page)).source).toBe(SOURCE);
  await page.evaluate(from => window.h.views[0].dispatch({ changes: { from, to: from + 4, insert: 'Plugin' }, userEvent: 'section-variants.structure' }), from);
  expect((await snapshot(page)).source).toBe(SOURCE.replace('Beta', 'Plugin'));
});

test('one click mounts native editing in the same column and typing changes the original note', async ({ page }) => {
  await create(page);
  await panel(page, 'A').locator('p').click();
  expect((await snapshot(page)).editingLabels).toEqual(['A']);
  expect((await snapshot(page)).focus).toBe(true);
  expect((await snapshot(page)).anchor).toBe(SOURCE.indexOf('Alpha'));
  await expect(page.locator('.cm-editor')).toHaveCount(2);
  await expect(panel(page, 'A').locator('.section-variants-column-editor .cm-content')).toBeFocused();
  await expect(panel(page, 'B').locator('p')).toBeVisible();
  await page.evaluate(() => window.h.columnSelect(0));
  await page.keyboard.type('Hello ');
  expect((await snapshot(page)).source).toBe(SOURCE.replace('Alpha', 'Hello Alpha'));
  await page.evaluate(() => window.h.undo());
  expect((await snapshot(page)).source).toBe(SOURCE);
  await page.evaluate(() => window.h.redo());
  expect((await snapshot(page)).source).toContain('Hello Alpha');
});

test('switching, Escape, click away and selection departure restore previews', async ({ page }) => {
  await create(page);
  await panel(page, 'A').locator('p').click();
  await panel(page, 'B').locator('p').click({ position: { x: 4, y: 4 } });
  expect((await snapshot(page)).editingLabels).toEqual(['B']);
  await page.keyboard.press('Escape');
  expect((await snapshot(page)).editingLabels).toEqual([]);
  await panel(page, 'A').locator('p').click();
  await page.locator('.cm-line').filter({ hasText: 'After' }).click();
  expect((await snapshot(page)).editingLabels).toEqual([]);
  await panel(page, 'A').locator('p').click();
  await page.evaluate(() => window.h.select(0));
  expect((await snapshot(page)).editingLabels).toEqual([]);
});

test('links, checkboxes and menus retain their own interaction', async ({ page }) => {
  await create(page);
  await panel(page, 'B').locator('a').click();
  expect((await snapshot(page)).editingLabels).toEqual([]);
  await panel(page, 'B').locator('input').check();
  expect((await snapshot(page)).editingLabels).toEqual([]);
  await panel(page, 'A').locator('p').click();
  await page.getByRole('button', { name: 'Open variants menu', exact: true }).click();
  await expect(page.locator('.section-variants-context-menu').first()).toBeVisible();
  expect((await snapshot(page)).editingLabels).toEqual(['A']);
});

test('positions and toolbar actions rebind after edits above a reused widget', async ({ page }) => {
  await create(page);
  await page.evaluate(() => window.h.edit(0, 0, 'Prefix\n'));
  await page.locator('.section-variants-marker').focus();
  await page.getByRole('button', { name: 'Add variant', exact: true }).click();
  expect(await page.evaluate(() => window.h.calls)).toEqual([14]);
  await panel(page, 'B').locator('p').click({ position: { x: 5, y: 5 } });
  expect((await snapshot(page)).anchor).toBe(('Prefix\n' + SOURCE).indexOf('Beta'));
  expect((await snapshot(page)).editingLabels).toEqual(['B']);
});

test('active positions map through external edits and deletion clears the target', async ({ page }) => {
  await create(page);
  await panel(page, 'A').locator('p').click();
  await page.evaluate(() => window.h.edit(0, 0, 'Prefix\n', undefined));
  expect((await snapshot(page)).editingLabels).toEqual(['A']);
  const b = (await snapshot(page)).blocks[0];
  await page.evaluate(b => window.h.edit(b.from, b.to, ''), b);
  expect((await snapshot(page)).editingLabels).toEqual([]);
  expect((await snapshot(page)).blocks).toEqual([]);
});

test('empty activation does not edit the note; first input and separator undo together', async ({ page }) => {
  const source = SOURCE.replace('Alpha\n', '');
  await create(page, source);
  await panel(page, 'A').locator('.section-variants-column-header > span').click();
  expect((await snapshot(page)).source).toBe(source);
  expect((await snapshot(page)).editingLabels).toEqual(['A']);
  await page.keyboard.type('Hello');
  expect((await snapshot(page)).source).toBe(source.replace('::: A\n', '::: A\nHello\n'));
  expect((await snapshot(page)).blocks[0].valid).toBe(true);
  await page.evaluate(() => window.h.undo());
  expect((await snapshot(page)).source).toBe(source);
});

test('hidden fences resist boundary deletion while paste and whole note replacement work', async ({ page }) => {
  await create(page);
  await panel(page, 'A').locator('p').click();
  await page.evaluate(() => window.h.columnSelect(0));
  await page.keyboard.press('Backspace');
  expect((await snapshot(page)).source).toBe(SOURCE);
  await page.evaluate(() => window.h.columnSelect(window.h.columnView().state.doc.length));
  await page.keyboard.press('Delete');
  expect((await snapshot(page)).source).toBe(SOURCE);
  await page.evaluate(() => { const v = window.h.snapshot().blocks[0].variants[0]; window.h.edit(v.from, v.to - 1, 'One\nTwo', 'input.paste'); });
  expect((await snapshot(page)).source).toBe(SOURCE.replace('Alpha', 'One\nTwo'));
  await page.evaluate(() => window.h.edit(0, window.h.snapshot().source.length, 'Replacement', 'input.paste'));
  expect((await snapshot(page)).source).toBe('Replacement');
});

test('split panes keep independent editing targets', async ({ page }) => {
  await create(page); await create(page);
  await panel(page, 'A').locator('p').click();
  expect(await page.evaluate(() => window.h.snapshot(1).editingLabels)).toEqual([]);
  await page.locator('.test-pane').nth(1).locator('.section-variants-panel[data-label="B"] p').click({ position: { x: 5, y: 5 } });
  expect(await page.evaluate(() => window.h.snapshot(1).editingLabels)).toEqual(['B']);
  await expect.poll(async () => (await snapshot(page)).editingLabels).toEqual([]);
});

const NESTED = 'Before\n::::: {.variants #outer view="columns"}\n:::: A\nOuter text\n:::: {.variants #inner view="columns"}\n::: X\nInner X\n:::\n::: Y\nInner Y\n:::\n::::\nAfter inner\n::::\n:::: B\nOther\n::::\n:::::\nAfter';

test('nested activation exposes ancestors and hiding the ancestor clears editing', async ({ page }) => {
  await create(page, NESTED);
  await panel(page, 'Y').locator('p').click();
  expect((await snapshot(page)).editingLabels).toEqual(['Y']);
  await expect(panel(page, 'X').locator('p')).toBeVisible();
  await expect(panel(page, 'B').locator('p')).toBeVisible();
  expect((await snapshot(page)).anchor).toBe(NESTED.indexOf('Inner Y'));
  await page.evaluate(() => window.h.hide(0, 'A'));
  expect((await snapshot(page)).editingLabels).toEqual([]);
});

test('typing preserves unrelated nested preview DOM and complete nested deletion works', async ({ page }) => {
  await create(page, NESTED + '\n' + NESTED.replace('#outer', '#other-outer').replace('#inner', '#other-inner'));
  await panel(page, 'B').locator('p').click();
  await page.evaluate(() => { window.savedNested = document.querySelector('.section-variants-nested'); window.savedRenderCount = window.renderCount; });
  await page.keyboard.type('New ');
  expect(await page.evaluate(() => document.querySelector('.section-variants-nested') === window.savedNested)).toBe(true);
  expect(await page.evaluate(() => window.renderCount)).toBe(await page.evaluate(() => window.savedRenderCount));
  await page.keyboard.press('Escape');
  await panel(page, 'A').locator('p').first().click();
  await page.evaluate(() => { const inner = window.h.snapshot().blocks[1]; window.h.edit(inner.from, inner.to, ''); });
  expect((await snapshot(page)).blocks).toHaveLength(3);
  expect((await snapshot(page)).blocks[0].valid).toBe(true);
});

test('Toggle is native immediately and malformed blocks stay visible', async ({ page }) => {
  await create(page, SOURCE.replace('view="columns"', 'view="toggle"'));
  await page.locator('.cm-line').filter({ hasText: 'Alpha' }).click();
  await page.keyboard.type('!');
  expect((await snapshot(page)).source).toContain('!');
  await create(page, SOURCE.replace('::::\nAfter', ''));
  expect(await page.locator('.test-pane').nth(1).locator('.section-variants-live-widget').count()).toBe(0);
});

test('touch taps activate, but scrolling gestures do not', async ({ page }) => {
  await create(page);
  const p = panel(page, 'A').locator('p');
  await p.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, button: 0, clientX: 50, clientY: 50 });
  expect((await snapshot(page)).editingLabels).toEqual([]);
  await p.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 7, button: 0, clientX: 50, clientY: 90 });
  await p.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, button: 0, clientX: 50, clientY: 50 });
  expect((await snapshot(page)).editingLabels).toEqual([]);
  await p.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 8, button: 0, clientX: 50, clientY: 50 });
  await p.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 8, button: 0, clientX: 50, clientY: 50 });
  expect((await snapshot(page)).editingLabels).toEqual(['A']);
});

test('clicking a nested Toggle exposes its native parent path', async ({ page }) => {
  await create(page, NESTED.replace('#inner view="columns"', '#inner view="toggle"'));
  await panel(page, 'X').locator('p').click();
  expect((await snapshot(page)).editingLabels).toEqual(['A']);
  await expect(page.locator('.cm-line').filter({ hasText: 'Inner X' })).toBeVisible();
});

test('deleting an active block cannot transfer editing to its next neighbor', async ({ page }) => {
  await create(page, SOURCE + '\n' + SOURCE.replace('#one', '#two'));
  await panel(page, 'A').locator('p').click();
  await page.evaluate(() => { const b = window.h.snapshot().blocks[0]; window.h.edit(b.from, window.h.snapshot().blocks[1].from, ''); });
  expect((await snapshot(page)).editingLabels).toEqual([]);
});

test('multiline native editing keeps the grid, widths, headers and sibling previews', async ({ page }) => {
  await create(page, SOURCE.replace('Alpha', 'First line\nSecond line\nThird line'));
  const geometry = () => page.locator('.section-variants-panel').evaluateAll(els => els.map(el => ({ left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width })));
  const before = await geometry();
  await panel(page, 'A').locator('p').click();
  await expect(page.locator('.section-variants-view-columns')).toHaveCount(1);
  await expect(panel(page, 'B').locator('p')).toBeVisible();
  await expect(panel(page, 'A').locator('.cm-line').filter({ hasText: 'Third line' })).toBeVisible();
  expect(await geometry()).toEqual(before);
  await expect(page.getByText('Editing below', { exact: true })).toHaveCount(0);
  await panel(page, 'B').locator('p').click({ position: { x: 4, y: 4 } });
  expect((await snapshot(page)).editingLabels).toEqual(['B']);
  expect((await snapshot(page)).source).toBe(SOURCE.replace('Alpha', 'First line\nSecond line\nThird line'));
});

test('preview prose inherits rendered theme rules, separately from controls', async ({ page }) => {
  await page.addStyleTag({ content: '.markdown-rendered{font-family:Arial}.markdown-rendered p {color:rgb(80,20,160);font-size:21px;line-height:1.7;margin-block-start:23px;padding-block-start:9px}.theme-dark .markdown-rendered p{color:rgb(180,150,240)}' });
  await create(page);
  await page.evaluate(() => {
    const reference = document.body.createDiv({ cls: 'markdown-rendered', attr: { id: 'reference' } });
    reference.createEl('p', { text: 'Alpha' });
  });
  const styles = () => page.evaluate(() => {
    const properties = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'marginTop', 'paddingTop'];
    const read = el => Object.fromEntries(properties.map(p => [p, getComputedStyle(el)[p]]));
    return { reference: read(document.querySelector('#reference p')), preview: read(document.querySelector('.section-variants-prose p')), controlInside: !!document.querySelector('.section-variants-column-header').closest('.markdown-rendered') };
  });
  let result = await styles();
  expect(result.preview).toEqual(result.reference);
  expect(result.controlInside).toBe(false);
  await page.evaluate(() => document.body.classList.add('theme-dark'));
  result = await styles();
  expect(result.preview).toEqual(result.reference);
  expect(result.preview.color).toBe('rgb(180, 150, 240)');
});

test('column contains native block widgets without replacing the comparison grid', async ({ page }) => {
  const source = SOURCE.replace('Alpha', 'Before widget\nWIDGET\nAfter widget');
  await create(page, source);
  await panel(page, 'A').locator('p').click();
  await page.evaluate(() => {
    const outer = window.h.views[0];
    window.h.views[0] = window.h.columnView();
    const from = window.h.views[0].state.doc.toString().indexOf('WIDGET');
    window.h.installBlockWidget(from, from + 6);
    window.h.views[0] = outer;
  });
  await expect(page.locator('.test-native-block')).toBeVisible();
  const frameHeight = () => panel(page, 'A').evaluate(el => el.getBoundingClientRect().height);
  await expect.poll(frameHeight).toBeGreaterThan(180);
  const before = await frameHeight();
  await page.locator('.test-native-block').evaluate(el => { el.style.height = '280px'; });
  await expect.poll(frameHeight).toBeGreaterThan(before + 90);
  await expect(panel(page, 'B').locator('p')).toBeVisible();
});

test('long native variants remain inside their column while the note scrolls', async ({ page }) => {
  await page.addStyleTag({ content: '.cm-editor{height:260px}.cm-scroller{overflow:auto}' });
  const source = SOURCE.replace('Alpha', Array.from({ length: 1000 }, (_, i) => 'Line ' + i).join('\n'));
  await create(page, source);
  await panel(page, 'A').locator('p').click({ position: { x: 5, y: 5 } });
  await expect.poll(() => panel(page, 'A').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(5000);
  await page.evaluate(() => { window.h.views[0].scrollDOM.scrollTop = 5000; });
  await expect.poll(() => page.evaluate(() => window.h.views[0].scrollDOM.scrollTop)).toBeGreaterThan(4000);
  await expect(page.locator('.section-variants-column-editor')).toHaveCount(1);
  await expect(page.locator('.section-variants-view-columns')).toHaveCount(1);
});

test('native multiline paste and keyboard undo/redo share the original note history', async ({ page }) => {
  await create(page);
  await panel(page, 'A').locator('p').click();
  await page.evaluate(() => { const view = window.h.columnView(); view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'One\nTwo\nThree' }, userEvent: 'input.paste' }); });
  expect((await snapshot(page)).source).toBe(SOURCE.replace('Alpha', 'One\nTwo\nThree'));
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  expect((await snapshot(page)).source).toBe(SOURCE);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
  expect((await snapshot(page)).source).toContain('One\nTwo\nThree');
  await expect(panel(page, 'B').locator('p')).toBeVisible();
});

test('typing after a source-position change keeps the same native editor and correct target', async ({ page }) => {
  await create(page);
  await panel(page, 'A').locator('p').click();
  await page.evaluate(() => { window.originalColumn = window.h.columnView(); window.h.edit(0, 0, 'Prefix\n'); });
  await page.keyboard.type('!');
  expect(await page.evaluate(() => window.originalColumn === window.h.columnView())).toBe(true);
  expect((await snapshot(page)).source).toContain('Prefix\nBefore');
  expect((await snapshot(page)).source).toMatch(/::: A\n[^\n]*![^\n]*\n:::/);
  expect((await snapshot(page)).source).toContain('Beta [link] [ ]');
});

test('empty variant paste retains its own trailing newline separately from the fence', async ({ page }) => {
  const source = SOURCE.replace('Alpha\n', '');
  await create(page, source);
  await panel(page, 'A').locator('.section-variants-column-header > span').click();
  await page.evaluate(() => window.h.columnView().dispatch({ changes: { from: 0, insert: 'One\n' }, userEvent: 'input.paste' }));
  expect((await snapshot(page)).source).toBe(source.replace('::: A\n', '::: A\nOne\n\n'));
  expect(await page.evaluate(() => window.h.columnView().state.doc.toString())).toBe('One\n');
  await page.evaluate(() => window.h.undo());
  expect((await snapshot(page)).source).toBe(source);
});

test('a rejected native deletion never displays unsaved child text', async ({ page }) => {
  await create(page);
  await panel(page, 'A').locator('p').click();
  await page.evaluate(() => { window.h.rejectColumnEdits(); const v = window.h.columnView(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '' }, userEvent: 'delete.selection' }); });
  expect((await snapshot(page)).source).toBe(SOURCE);
  expect(await page.evaluate(() => window.h.columnView().state.doc.toString())).toBe('Alpha');
});

test('editing a nested column inside an active parent reaches the original note', async ({ page }) => {
  await create(page, NESTED);
  await panel(page, 'A').locator('p').first().click();
  const nested = panel(page, 'A').locator('.section-variants-column-editor .section-variants-panel[data-label="Y"]').last();
  await nested.locator('p').click();
  await expect(nested.locator('.section-variants-column-editor .cm-content')).toBeFocused();
  await page.keyboard.type('!');
  expect((await snapshot(page)).source).toMatch(/::: Y\n[^\n]*![^\n]*\n:::/);
  await expect(panel(page, 'B').locator('p')).toBeVisible();
  await page.keyboard.press('Escape');
  expect((await snapshot(page)).editingLabels).toEqual(['A']);
});

for (const kind of ['add','rename','deleteVariant','deleteBox','widths','insert']) test(`async ${kind} dialog submits once while its callback is pending`, async ({page}) => {
  await page.evaluate(kind=>{
    const h=window.h,block=h.parseNote(':::: {.variants #one}\n::: A\nOne\n:::\n::: B\nTwo\n:::\n::::').blocks[0];
    window.dialogCalls=0;const callback=()=>{window.dialogCalls++;return new Promise(resolve=>window.finishDialog=resolve);};
    const constructors={add:()=>new h.dialogs.AddVariantModal(h.host.app,block,[],callback),rename:()=>new h.dialogs.RenameVariantModal(h.host.app,'A',callback),deleteVariant:()=>new h.dialogs.DeleteVariantConfirmationModal(h.host.app,'A',callback),deleteBox:()=>new h.dialogs.DeleteBlockConfirmationModal(h.host.app,undefined,callback),widths:()=>new h.dialogs.ColumnRatiosModal(h.host.app,block,callback),insert:()=>new h.dialogs.InsertVariantsModal(h.host.app,[],callback)};
    window.reviewDialog=constructors[kind]();window.reviewDialog.open();const method=kind.startsWith('delete')?'confirm':'submit';window.reviewDialog[method]();window.reviewDialog[method]();
  },kind);
  expect(await page.evaluate(()=>window.dialogCalls)).toBe(1);
  await expect(page.locator('.modal-content')).toHaveAttribute('aria-busy','true');
  expect(await page.locator('.modal-content button').evaluateAll(items=>items.every(item=>item.disabled))).toBe(true);
  await page.evaluate(()=>window.finishDialog());
  await expect(page.locator('.modal-content')).toHaveCount(0);
  expect(await page.evaluate(()=>window.dialogCalls)).toBe(1);
});

test('insertion default follows its row through removal and rename',async({page})=>{
  await page.evaluate(()=>{window.insertedOptions=null;window.reviewDialog=new window.h.dialogs.InsertVariantsModal(window.h.host.app,[],options=>{window.insertedOptions=options;});window.reviewDialog.open();});
  await page.getByRole('button',{name:'Add variant',exact:true}).click();
  await page.locator('.modal-content select').first().selectOption('1');
  await page.locator('[data-name="Variant 1"] button').click();
  await page.locator('[data-name="Variant 1"] input').fill('Renamed B');
  await expect(page.locator('.modal-content select').first().locator('option:checked')).toHaveText('Renamed B');
  await page.getByRole('button',{name:'Insert',exact:true}).click();
  expect(await page.evaluate(()=>window.insertedOptions.defaultLabel)).toBe('Renamed B');
});

test('Home and End skip disabled items, and IME confirmation does not submit a box name',async({page})=>{
  await page.evaluate(()=>{const button=document.body.createEl('button',{text:'Open menu'});button.onclick=event=>window.h.openAttachedMenu(event,[{label:'Disabled',disabled:true},{label:'First'},{label:'Middle'},{label:'Last'},{label:'End disabled',disabled:true}]);button.click();});
  await page.keyboard.press('End');await expect(page.locator('[role="menuitem"]:focus')).toHaveText('Last');await page.keyboard.press('Home');await expect(page.locator('[role="menuitem"]:focus')).toHaveText('First');
  await page.evaluate(()=>{window.h.closeAttachedMenus();window.imeCommits=0;const button=document.body.createEl('button',{text:'Name'});button.onclick=event=>window.h.openAttachedMenu(event,[{label:'Name',input:{value:'',ariaLabel:'Box name',onSubmit:()=>window.imeCommits++}}]);button.click();const input=document.querySelector('.section-variants-context-menu input');input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));});
  expect(await page.evaluate(()=>window.imeCommits)).toBe(0);await expect(page.locator('.section-variants-context-menu')).toHaveCount(1);
  await page.evaluate(()=>{const input=document.querySelector('.section-variants-context-menu input');input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});expect(await page.evaluate(()=>window.imeCommits)).toBe(1);
});

for(const stage of ['constructor','load','set'])test(`native editor ${stage} failure cleans its mount and retains readable source`,async({page})=>{
  await create(page);await page.evaluate(stage=>{window.nativeFailureStage=stage;},stage);await panel(page,'A').locator('p').click();await expect(page.locator('.section-variants-column-editor')).toHaveCount(0);await expect(panel(page,'A').locator('p')).toBeVisible();expect((await snapshot(page)).source).toBe(SOURCE);expect(await page.evaluate(()=>window.notices.some(text=>text.includes('could not open')))).toBe(true);
});

test('Reading View reuses unchanged bodies for selection, visibility and view updates',async({page})=>{
  await page.evaluate(()=>{const source=':::: {.variants #reading view="columns"}\n::: A\nFirst\n:::\n::: B\nSecond\n:::\n::::';window.readingSource=source;const root=document.body.createDiv({cls:'reading-test'});document.body.append(root);window.readingBlock=window.h.parseNote(source).blocks[0];window.readingRenderer=new window.h.VariantBlockRenderer(window.h.host,root,'Reading.md',source,window.readingBlock);window.readingRenderer.load();});
  await expect(page.locator('.reading-test .section-variants-prose p')).toHaveCount(2);const before=await page.evaluate(()=>window.renderCount);
  await page.evaluate(()=>{window.h.store.setSelectedLabel('Reading.md',window.readingBlock,'B');window.h.store.toggleHidden('Reading.md',window.readingBlock,'A');window.h.store.setView('Reading.md',window.readingBlock,'toggle');});
  expect(await page.evaluate(()=>window.renderCount)).toBe(before);await expect(page.locator('.reading-test .section-variants-panel[data-label="B"]')).toBeVisible();await expect(page.locator('.reading-test .section-variants-panel[data-label="A"]')).not.toBeVisible();await page.evaluate(()=>window.readingRenderer.unload());await expect(page.locator('.reading-test').locator('button')).toHaveCount(0);
});

test('unload cancels a Reading coordinator read and owned menu actions',async({page})=>{
  await page.evaluate(()=>{const file=new window.h.TFile('Reading.md');const host={...window.h.host,app:{...window.h.host.app,vault:{getAbstractFileByPath:()=>file,cachedRead:()=>new Promise(resolve=>window.finishRead=resolve)}}};window.coordinator=new window.h.ReadingViewCoordinator(host);const root=document.body.createDiv({cls:'markdown-preview-view'});document.body.append(root);const paragraph=root.createEl('p',{text:':::: variants'});window.coordinator.postProcess(paragraph,{sourcePath:'Reading.md',getSectionInfo:()=>({lineStart:0,lineEnd:20}),addChild:()=>window.lateChildren++});window.lateChildren=0;});
  await expect.poll(()=>page.evaluate(()=>typeof window.finishRead)).toBe('function');await page.evaluate(()=>{window.coordinator.dispose();window.finishRead(':::: {.variants}\n::: A\nFirst\n:::\n::: B\nSecond\n:::\n::::');});expect(await page.evaluate(()=>window.lateChildren)).toBe(0);await expect(page.locator('.section-variants-mount')).toHaveCount(0);
  await page.evaluate(()=>{const button=document.body.createEl('button');button.onclick=event=>window.h.openAttachedMenu(event,[{label:'Action',onSelect:()=>window.lateChildren++}]);button.click();window.h.closeAttachedMenus();});await expect(page.locator('.section-variants-context-menu')).toHaveCount(0);
});

for(const mode of ['authored','current'])test(`unowned and invalid nested text remain in ${mode} HTML`,async({page})=>{
  const html=await page.evaluate(async mode=>{const child=':::: {.variants}\n::: A\nNested one\n:::\n::: A\nNested duplicate\n:::\n::::';const source=`:::::: {.variants}\nPreamble\n::::: A\n${child}\n:::::\nBetween\n::::: B\nSecond\n:::::\nTrailing\n::::::`;return window.h.renderHtmlDocument({app:window.h.host.app,store:window.h.store.snapshot()},new window.h.TFile('Export.md'),source,window.h.parseNote(source),mode);},mode);for(const text of ['Preamble','Between','Trailing','Nested one','Nested duplicate','Second'])expect(html).toContain(text);
});

test('reusing the same sticky view binds its global controls to the new note',async({page})=>{
  await page.evaluate(()=>{const h=window.h;const block=(id)=>`:::: {.variants #${id}}\n::: A\nFirst\n:::\n::: B\nSecond\n:::\n::::`;const source=block('one')+'\n'+block('two');const view=new h.MarkdownView();view.file={path:'First.md'};view.editor={getValue:()=>source};view.containerEl=document.body.createDiv();const host={...h.host,app:{...h.host.app,workspace:{...h.host.app.workspace,getLeavesOfType:()=>[{view}]}}};window.sticky=new h.StickyControlManager(host);window.sticky.refresh();view.file={path:'Second.md'};window.sticky.refresh();view.containerEl.querySelector('.section-variants-labels button[aria-label="B"]').click();});
  expect(await page.evaluate(()=>window.h.store.getNote('Second.md')?.globalLabel)).toBe('B');expect(await page.evaluate(()=>window.h.store.getNote('First.md')?.globalLabel)).toBeUndefined();await page.evaluate(()=>window.sticky.destroy());await expect(page.locator('.section-variants-sticky-control')).toHaveCount(0);
});

test('export captures editor text and UI state once and does not repeat a delayed file creation',async({page})=>{
  await page.evaluate(()=>{const h=window.h,file=new h.TFile('Export.md');window.exportSource=':::: {.variants #export}\n::: A\nFirst\n:::\n::: B\nEditor snapshot\n:::\n::::';const block=h.parseNote(window.exportSource).blocks[0];h.store.setSelectedLabel('Export.md',block,'B');window.exportCreates=0;window.exportReads=0;const host={...h.host,app:{...h.host.app,workspace:{...h.host.app.workspace,getLeaf:()=>({openFile:async()=>{}})},vault:{cachedRead:async()=>window.exportSource.replace('Editor snapshot','Disk text'),getAbstractFileByPath:()=>null,create:async(path,html)=>{window.exportCreates++;window.exportedHtml=html;await new Promise(resolve=>window.finishExport=resolve);}}}};window.exportModal=new h.HtmlExportModal(host,file,()=>{window.exportReads++;return window.exportSource;});window.exportModal.open();window.exportModal.state='current';window.exportModal.export();window.exportModal.export();window.exportSource=window.exportSource.replace('Editor snapshot','Later editor text');h.store.setSelectedLabel('Export.md',block,'A');});
  await expect.poll(()=>page.evaluate(()=>typeof window.finishExport)).toBe('function');expect(await page.evaluate(()=>window.exportCreates)).toBe(1);expect(await page.evaluate(()=>window.exportReads)).toBe(1);const html=await page.evaluate(()=>window.exportedHtml);expect(html).toContain('Editor snapshot');expect(html).not.toContain('Disk text');expect(html).not.toContain('Later editor text');expect(html).not.toContain('<h2>A</h2>');await page.evaluate(()=>window.finishExport());await expect(page.locator('.modal-content')).toHaveCount(0);
});

test('a delayed fallback cannot create a nested renderer after its owner unloads',async({page})=>{
  await page.evaluate(()=>{const h=window.h;const child=':::: {.variants}\n::: A\nNested first\n:::\n::: B\nNested second\n:::\n::::';const source=`:::::: {.variants #outer}\n::::: A\nBefore child\n${child}\nAfter child\n:::::\n::::: B\nOther\n:::::\n::::::`;window.unsupportedPreview=true;window.renderDelay=new Promise(resolve=>window.finishFallback=resolve);const root=document.body.createDiv({cls:'late-render-root'});window.lateRenderer=new h.VariantBlockRenderer(h.host,root,'Late.md',source,h.parseNote(source).blocks[0]);window.lateRenderer.load();});
  await expect.poll(()=>page.evaluate(()=>window.renderCount)).toBeGreaterThan(0);await page.evaluate(()=>{window.lateRenderer.unload();window.finishFallback();window.renderDelay=null;});await expect(page.locator('.late-render-root').locator('*')).toHaveCount(0);expect(await page.evaluate(()=>window.lateRenderer.nestedRenderers.length)).toBe(0);
});

for (const responsive of ['responsive', 'stack', 'scroll']) test(`standalone HTML retains authored ${responsive} layout and ratios`, async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const result = await page.evaluate(async responsive => {
    const h = window.h;
    const source = `:::: {.variants view="columns" widths="2fr 1fr" min-width="150px" responsive="${responsive}"}\n::: A\nFirst text\n:::\n::: B\nSecond text\n:::\n::::`;
    const html = await h.renderHtmlDocument({ app: h.host.app, store: h.store.snapshot() }, { path: 'Layout.md', basename: 'Layout' }, source, h.parseNote(source), 'authored');
    const frame = document.createElement('iframe'); frame.style.width = '1100px'; frame.style.height = '500px'; frame.srcdoc = html;
    await new Promise(resolve => { frame.onload = resolve; document.body.append(frame); });
    const block = frame.contentDocument.querySelector('.section-variants-export-columns');
    const wide = getComputedStyle(block).gridTemplateColumns.split(' ').map(parseFloat);
    frame.style.width = '250px'; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { responsive: block.dataset.responsive, wide, narrow: getComputedStyle(block).gridTemplateColumns.split(' ').length, overflow: block.scrollWidth > block.clientWidth };
  }, responsive);
  expect(result.responsive).toBe(responsive);
  if (responsive === 'stack') expect(result.wide.length).toBe(1);
  else expect(result.wide[0] / result.wide[1]).toBeCloseTo(2, 1);
  if (responsive === 'scroll') expect(result.overflow).toBe(true);
  else expect(result.narrow).toBe(1);
});


test('whole-note external replacement rebinds a unique authored column ID', async ({page})=>{
 await create(page);await panel(page,'A').locator('p').click();
 await page.evaluate(()=>{const view=window.h.views[0];view.dispatch({changes:{from:0,to:view.state.doc.length,insert:view.state.doc.toString().replace('Alpha','Updated externally')},userEvent:'set'})});
 await expect(page.locator('.section-variants-column-editor')).toHaveCount(1);await panel(page,'A').locator('.cm-content').pressSequentially('!');
 expect((await snapshot(page)).source).toMatch(/Updated externally.*!|!.*Updated externally/);expect((await snapshot(page)).source).toContain('Beta [link] [ ]');
});
