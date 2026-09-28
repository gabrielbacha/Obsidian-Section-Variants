// Opt-in integration test against an installed Obsidian, in an isolated vault.
// Never opens, modifies, or closes the user's existing vault/window.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchObsidian } from './obsidian-harness.mjs';
import { verifyNativePreviews } from './obsidian-preview-checks.mjs';

const source = '# Runtime verification\n\n:::: {.variants #runtime view="columns" responsive="scroll"}\n::: First\nAlpha original.\n:::\n::: Second\n### Heading\n\nBeta comparison with **bold**.\n:::\n::::\n\nOutside.\n';
const { page, vault, directory, close } = await launchObsidian({ files: { 'Verification.md': source } });
const conflictFolderEntries = async () => readdir(path.join(vault, 'Section Variants Conflicts')).catch(() => []);
try {
	await page.evaluate(async () => {
		app.vault.setConfig('showLineNumber', true);
		await app.workspace.getLeaf().openFile(app.vault.getAbstractFileByPath('Verification.md'));
		await app.workspace.getLeaf().setViewState({ type: 'markdown', state: { file: 'Verification.md', mode: 'source', source: false } });
	});
	const first = page.locator('.section-variants-panel[data-label="First"]').first();
	const second = page.locator('.section-variants-panel[data-label="Second"]').first();
	await first.waitFor({ state: 'visible' });
	const geometry = () => page.locator('.section-variants-panel').evaluateAll(els => els.map(el => ({ left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width })));
	const before = await geometry();
	await first.locator('p').click();
	await first.locator('.section-variants-column-editor .cm-content').waitFor({ state: 'visible' });
	const external = source.replace('Alpha original.', 'Alpha changed by an external agent.').replace('Outside.', 'Outside, changed by an external agent.');
	await page.evaluate(() => {
		window.externalTrace = [];
		app.vault.on('modify', file => {
			if (file.path !== 'Verification.md') return;
			const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === file.path)?.view;
			window.externalTrace.push({ event: 'modify', note: view?.editor.getValue(), active: app.workspace.activeEditor?.editor?.getValue?.() });
		});
	});
	await writeFile(path.join(vault, 'Verification.md'), external);
	await page.waitForFunction(expected => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md')?.view.editor.getValue() === expected, external);
	await first.locator('.section-variants-column-editor .cm-content').waitFor({ state: 'visible' });
	const externalState = await page.evaluate(() => ({
		note: app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md')?.view.editor.getValue(),
		active: app.workspace.activeEditor?.editor?.getValue?.(),
		trace: window.externalTrace,
	}));
	const diskAfterExternal = await readFile(path.join(vault, 'Verification.md'), 'utf8');
	if (diskAfterExternal !== external || externalState.note !== external || externalState.active !== 'Alpha changed by an external agent.') throw new Error('External edit did not reach both editors: ' + JSON.stringify(externalState));
	if (!externalState.trace.some(event => event.active === 'Alpha original.')) throw new Error('The test did not capture the stale child editor at the external modify event.');
	await page.evaluate(async () => { await app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.save(); });
	if (await readFile(path.join(vault, 'Verification.md'), 'utf8') !== external) throw new Error('Save restored stale content after external edit.');
	const gutterAlignment = await first.evaluate(panel => {
		const column = panel.querySelector('.section-variants-column-editor');
		const gutter = column.querySelector('.cm-gutters');
		return {
			gutterHidden: !gutter || getComputedStyle(gutter).display === 'none',
			textOffset: column.querySelector('.cm-line').getBoundingClientRect().left - panel.getBoundingClientRect().left,
		};
	});
	if (!gutterAlignment.gutterHidden || Math.abs(gutterAlignment.textOffset) > 1) throw new Error('Column gutter shifted text: ' + JSON.stringify(gutterAlignment));
	const outerGutter = await page.locator('.cm-editor').first().locator('.cm-gutters').first().evaluate(el => getComputedStyle(el).display);
	if (outerGutter === 'none') throw new Error('The main note gutter was hidden.');
	if (!await second.locator('h3').isVisible()) throw new Error('Sibling preview disappeared.');
	const after = await geometry();
	if (before.some((rect, i) => Math.abs(rect.left - after[i].left) > 1 || Math.abs(rect.width - after[i].width) > 1)) throw new Error('Activation changed column geometry.');
	await page.screenshot({ path: path.join(directory, 'in-column.png') });
	await page.keyboard.type('CHECK');
	const edited = await page.evaluate(() => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.editor.getValue());
	if (!edited.includes('CHECK') || !edited.includes('Beta comparison')) throw new Error('Typing did not update the note safely.');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
	await page.waitForFunction(original => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.editor.getValue() === original, external).catch(async error => {
		throw new Error('Undo did not restore the external version: ' + JSON.stringify(await page.evaluate(() => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.editor.getValue())), { cause: error });
	});
	await page.evaluate(async () => { await app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.save(); });
	const diskAfterSave = await readFile(path.join(vault, 'Verification.md'), 'utf8');
	if (diskAfterSave !== external) throw new Error('A save restored stale note content after external edit.');
	await second.locator('p').click();
	await second.locator('.section-variants-column-editor .cm-content').waitFor({ state: 'visible' });
	if (!await first.locator('p').isVisible()) throw new Error('Previous column did not return to preview.');
	await page.keyboard.press('Escape');
	await page.locator('.section-variants-column-editor').waitFor({ state: 'detached' });
	console.log('PASS: real Obsidian click → in-column native editor → type → note update → undo → switch → Escape.');
	await verifyNativePreviews(page, directory);
	await page.evaluate(async () => {
		const leaf = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md');
		await leaf.setViewState({ type: 'markdown', state: { file: 'Verification.md', mode: 'source', source: false } });
	});
	await second.locator('p').first().click();
	await second.locator('.section-variants-column-editor').waitFor({ state: 'visible' });
	await second.locator('.section-variants-column-editor .cm-hmd-internal-link').first().waitFor({ state: 'attached' });
	await second.locator('.section-variants-column-editor .internal-embed.is-loaded').first().waitFor({ state: 'attached' });
	await page.keyboard.press('Escape');
	const beforeIdle = await readFile(path.join(vault, 'Verification.md'), 'utf8');
	const idleExternal = beforeIdle.replace('Alpha', 'Alpha changed while idle');
	await writeFile(path.join(vault, 'Verification.md'), idleExternal);
	await page.waitForFunction(expected => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.editor.getValue() === expected, idleExternal);
	await page.waitForTimeout(250);
	const beforeConflict = await readFile(path.join(vault, 'Verification.md'), 'utf8');
	await page.evaluate(() => {
		const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view;
		window.originalConflictSave = view.save;
		view.save = async () => {};
		view.editor.replaceRange('LOCAL UNSAVED\n', { line: 0, ch: 0 });
	});
	const conflictExternal = beforeConflict.replace('Alpha changed while idle', 'Alpha changed again by agent');
	await writeFile(path.join(vault, 'Verification.md'), conflictExternal);
	await page.evaluate(() => app.vault.trigger('modify', app.vault.getFileByPath('Verification.md')));
	// Obsidian owns this case. It must behave exactly as for an ordinary note:
	// its merge keeps the unsaved local line and applies the external change.
	await page.waitForFunction(() => {
		const value = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.editor.getValue();
		return value.includes('LOCAL UNSAVED') && value.includes('Alpha changed again by agent');
	});
	await page.evaluate(() => { const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view; view.save = window.originalConflictSave; });
	if ((await conflictFolderEntries()).length) throw new Error('Section Variants created a conflict copy instead of leaving the merge to Obsidian.');
	await page.evaluate(async () => { await app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.save(); });
	const merged = await readFile(path.join(vault, 'Verification.md'), 'utf8');
	if (!merged.includes('LOCAL UNSAVED') || !merged.includes('Alpha changed again by agent')) throw new Error('The merged note was not saved: ' + merged);
	console.log('PASS: concurrent local and external edits use Obsidian\'s own merge, with no plugin copies.');
	const splitBase = merged;
	await page.evaluate(async () => {
		const file = app.vault.getFileByPath('Verification.md');
		const leaf = app.workspace.getLeaf('split');
		await leaf.openFile(file);
		await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: false } });
	});
	const splitExternal = splitBase.replace('Alpha changed again by agent', 'Alpha from a split-pane agent edit');
	await writeFile(path.join(vault, 'Verification.md'), splitExternal);
	await page.waitForFunction(expected => {
		const views = app.workspace.getLeavesOfType('markdown').filter(leaf => leaf.view.file?.path === 'Verification.md');
		return views.length >= 2 && views.every(leaf => leaf.view.editor.getValue() === expected);
	}, splitExternal);
	const rapidFirst = splitExternal.replace('Alpha from a split-pane agent edit', 'Rapid first edit');
	const rapidLast = rapidFirst.replace('Rapid first edit', 'Rapid final edit');
	await writeFile(path.join(vault, 'Verification.md'), rapidFirst);
	await writeFile(path.join(vault, 'Verification.md'), rapidLast);
	await page.waitForFunction(expected => app.workspace.getLeavesOfType('markdown').filter(leaf => leaf.view.file?.path === 'Verification.md').every(leaf => leaf.view.editor.getValue() === expected), rapidLast);
	if (await readFile(path.join(vault, 'Verification.md'), 'utf8') !== rapidLast) throw new Error('Rapid external writes were reverted.');
	console.log('PASS: split panes and rapid external writes converge on the latest disk version.');
	const removedVariants = '# The agent removed the variants block\n\nNow an ordinary note.\n';
	await writeFile(path.join(vault, 'Verification.md'), removedVariants);
	await page.waitForFunction(expected => app.workspace.getLeavesOfType('markdown').filter(leaf => leaf.view.file?.path === 'Verification.md').every(leaf => leaf.view.editor.getValue() === expected), removedVariants);
	if (await readFile(path.join(vault, 'Verification.md'), 'utf8') !== removedVariants) throw new Error('Removing the last variants block was reverted.');
	const ordinary = '# Ordinary note\n\nThis has no variants.\n\n```md\n:::: {.variants}\n```\n';
	await page.evaluate(async source => {
		const file = await app.vault.create('Ordinary.md', source);
		const leaf = app.workspace.getLeaf('split');
		await leaf.openFile(file);
		await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: false } });
		window.ordinarySave = leaf.view.save;
		leaf.view.save = async () => {};
		leaf.view.editor.replaceRange('LOCAL UNSAVED\n', { line: 0, ch: 0 });
	}, ordinary);
	const ordinaryExternal = ordinary.replace('This has no variants.', 'An agent changed this ordinary note.');
	await writeFile(path.join(vault, 'Ordinary.md'), ordinaryExternal);
	await page.evaluate(() => app.vault.trigger('modify', app.vault.getFileByPath('Ordinary.md')));
	await page.waitForTimeout(500);
	const ordinaryState = await page.evaluate(() => {
		const plugin = app.plugins.plugins['section-variants'];
		const leaf = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Ordinary.md');
		leaf.view.save = window.ordinarySave;
		return { blocks: plugin.parse(leaf.view.editor.getValue()).blocks.length };
	});
	if (ordinaryState.blocks || (await conflictFolderEntries()).length || await readFile(path.join(vault, 'Ordinary.md'), 'utf8') !== ordinaryExternal) throw new Error('Section Variants interfered with an ordinary Markdown note: ' + JSON.stringify(ordinaryState));
	console.log('PASS: ordinary Markdown notes are outside Section Variants, even with variant syntax inside code fences.');
} finally {
	await close();
}
