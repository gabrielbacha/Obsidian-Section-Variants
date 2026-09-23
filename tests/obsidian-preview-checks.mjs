import assert from 'node:assert/strict';
import path from 'node:path';

const sample = [
  '### Theme formatting sample', '',
  'Beta comparison with **bold**, *emphasis*, and `inline code`. [[Embed target]]', '',
  '- First item', '- Second item', '',
  '> [!info] Callout', '> Theme-styled content.', '',
  '| Column | Value |', '| --- | --- |', '| First | Second |', '',
  '```js', 'const value = 1;', '```', '',
  '- Loose first', '', '- Loose second', '',
  '- [ ] Preview task', '', '![[Embed target]]', '',
].join('\n');

export async function verifyNativePreviews(page, directory) {
  await page.evaluate(async sample => {
    await app.vault.create('Embed target.md', 'Embedded **native** content.');
    const leaf = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Verification.md');
    leaf.view.editor.setValue(':::: {.variants #formatting view="columns" responsive="scroll"}\n\n::: First\n\nAlpha\n\n:::\n\n::: Second\n\n' + sample + '\n:::\n\n::::\n');
    await app.vault.create('Reference.md', sample);
    const ref = app.workspace.getLeaf('split');
    await ref.openFile(app.vault.getFileByPath('Reference.md'));
    await ref.setViewState({ type: 'markdown', state: { file: 'Reference.md', mode: 'preview' } });
  }, sample);
  let cellSelector = '.markdown-source-view .section-variants-panel[data-label="Second"] .section-variants-preview > .markdown-preview-view';
  await page.locator(`${cellSelector} .el-ul .list-bullet`).first().waitFor({ state: 'attached' });
  await page.locator(`${cellSelector} .internal-embed.is-loaded`).waitFor({ state: 'attached' });
  await page.waitForFunction(() => app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Reference.md').view.previewMode.renderer.sizerEl.querySelector('.internal-embed.is-loaded'));

  async function compare(label) {
    await page.waitForFunction(selector => document.querySelector(selector)?.querySelector('.internal-embed')?.textContent.includes('Embedded native content.'), cellSelector);
    const metrics = await page.evaluate(cellSelector => {
      const cell = document.querySelector(cellSelector).querySelector('.markdown-preview-sizer');
      const ref = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Reference.md').view.previewMode.renderer.sizerEl;
      // Equal prose widths, leaving all native content styling untouched.
      ref.style.width = cell.getBoundingClientRect().width + 'px';
      ref.style.maxWidth = 'none';
      const properties = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'whiteSpace'];
      function measure(root) {
        const nodes = [...root.querySelectorAll('h3,p,ul,li,.callout,.callout-title,.callout-content,table,pre,code,a.internal-link')];
        const list = root.querySelector('.el-ul ul');
        const items = list.querySelectorAll(':scope > li');
        const callout = root.querySelector('.callout');
        return {
          width: root.getBoundingClientRect().width,
          listGap: items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top,
          calloutGap: callout.querySelector('p').getBoundingClientRect().top - callout.querySelector('.callout-title').getBoundingClientRect().bottom,
          nodes: nodes.map(el => ({ tag: el.tagName, text: el.textContent, callout: el.matches('.callout'), styles: Object.fromEntries(properties.map(p => [p, getComputedStyle(el)[p]])) })),
        };
      }
      return { cell: measure(cell), ref: measure(ref) };
    }, cellSelector);
    assert.equal(metrics.cell.width, metrics.ref.width, `${label}: equal widths`);
    assert.equal(metrics.cell.listGap, metrics.ref.listGap, `${label}: tight list spacing`);
    assert.equal(metrics.cell.calloutGap, metrics.ref.calloutGap, `${label}: callout spacing`);
    // Obsidian itself intentionally sets `.markdown-source-view.mod-cm6
    // .callout { margin: 0 }`. Do not patch that native embedded-mode rule.
    if (cellSelector.startsWith('.markdown-source-view')) {
      for (let i = 0; i < metrics.cell.nodes.length; i++) {
        if (!metrics.cell.nodes[i].callout) continue;
        assert.equal(metrics.cell.nodes[i].styles.marginTop, '0px');
        assert.equal(metrics.cell.nodes[i].styles.marginBottom, '0px');
        for (const p of ['marginTop', 'marginBottom']) {
          delete metrics.cell.nodes[i].styles[p];
          delete metrics.ref.nodes[i].styles[p];
        }
      }
    }
    assert.deepEqual(metrics.cell.nodes, metrics.ref.nodes, `${label}: native content styles`);
    console.log(`PASS: ${label}: native markup/styles; list spacing ${metrics.cell.listGap}px; callout gap ${metrics.cell.calloutGap}px.`);
    return metrics.cell.nodes[0].styles;
  }
  await compare('Live Preview inactive cell');
  await page.screenshot({ path: path.join(directory, 'native-formatting.png') });

  // Theme mode changes must apply to mounted previews without reopening notes.
  await page.evaluate(() => { document.body.removeClass('theme-light'); document.body.addClass('theme-dark'); app.workspace.trigger('css-change'); });
  await compare('Dark mode');
  await page.evaluate(() => { document.body.removeClass('theme-dark'); document.body.addClass('theme-light'); app.workspace.trigger('css-change'); });
  const originalHeading = await compare('Light mode');
  const theme = await page.evaluate(() => app.customCss.theme);
  if (theme) {
    async function switchTheme(theme) {
      await page.evaluate(theme => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { app.workspace.offref(event); reject(new Error('Theme did not load')); }, 10000);
        const event = app.workspace.on('css-change', () => { clearTimeout(timeout); app.workspace.offref(event); resolve(); });
        app.customCss.setTheme(theme);
      }), theme);
    }
    await switchTheme('');
    const defaultHeading = await compare('Default theme, without reopening');
    assert.notDeepEqual(defaultHeading, originalHeading, 'Theme switch must actually change rendered heading styling');
    await switchTheme(theme);
    assert.deepEqual(await compare('Restored theme, without reopening'), originalHeading);
  }

  // Source offsets shift while this preview stays mounted, then a checkbox edits
  // the original note through the owning editor and can be undone there.
  await page.evaluate(() => {
    window.retainedVariantPreview = document.querySelector('.section-variants-panel[data-label="Second"] .section-variants-preview');
    const view = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Verification.md').view;
    view.editor.replaceRange('Prefix\n\n', { line: 0, ch: 0 });
  });
  assert(await page.evaluate(() => window.retainedVariantPreview === document.querySelector('.section-variants-panel[data-label="Second"] .section-variants-preview')));
  await page.locator(`${cellSelector} input[type="checkbox"]`).check();
  await page.waitForFunction(() => app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Verification.md').view.editor.getValue().includes('- [x] Preview task'));
  await page.evaluate(() => app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Verification.md').view.editor.undo());
  await page.waitForFunction(() => app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Verification.md').view.editor.getValue().includes('- [ ] Preview task'));

  await page.evaluate(async () => {
    const leaf = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === 'Verification.md');
    await leaf.view.save();
    await leaf.setViewState({ type: 'markdown', state: { file: 'Verification.md', mode: 'preview' } });
  });
  // Source view remains hidden in the DOM; explicitly select the Reading View.
  cellSelector = '.markdown-reading-view .section-variants-panel[data-label="Second"] .section-variants-preview > .markdown-preview-view';
  await page.locator(`${cellSelector} .el-ul`).first().waitFor({ state: 'visible' });
  await compare('Reading View inactive cell');
  await page.locator(`${cellSelector} input[type="checkbox"]`).click();
  await page.waitForFunction(async () => (await app.vault.cachedRead(app.vault.getFileByPath('Verification.md'))).includes('- [x] Preview task'));
  await page.waitForFunction(selector => document.querySelector(selector)?.querySelector('input[type="checkbox"]')?.checked, cellSelector);
  console.log('PASS: Reading View native formatting and atomic checkbox edit; Live Preview source rebinding and undo verified.');
}
