// Opt-in integration test against an installed Obsidian, in an isolated vault.
// Never opens, modifies, or closes the user's existing vault/window.
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyNativePreviews } from './obsidian-preview-checks.mjs';

const executable = process.env.OBSIDIAN_EXECUTABLE;
if (!executable) throw new Error('Set OBSIDIAN_EXECUTABLE to the installed Obsidian executable.');
const directory = await mkdtemp(path.join(tmpdir(), 'section-variants-runtime-'));
const profile = path.join(directory, 'profile');
const vault = path.join(directory, 'vault');
const plugin = path.join(vault, '.obsidian/plugins/section-variants');
await mkdir(profile, { recursive: true });
await mkdir(plugin, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) await copyFile(name, path.join(plugin, name));
if (process.env.OBSIDIAN_ASAR) await copyFile(process.env.OBSIDIAN_ASAR, path.join(profile, path.basename(process.env.OBSIDIAN_ASAR)));
await writeFile(path.join(profile, 'obsidian.json'), JSON.stringify({ updateDisabled: true, vaults: { '0123456789abcdef': { path: vault, ts: Date.now(), open: true } } }));
await writeFile(path.join(vault, '.obsidian/app.json'), JSON.stringify({ livePreview: true }));
await writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['section-variants']));
if (process.env.OBSIDIAN_THEME_DIR) {
	const name = path.basename(process.env.OBSIDIAN_THEME_DIR);
	const theme = path.join(vault, '.obsidian/themes', name);
	await mkdir(theme, { recursive: true });
	for (const file of ['theme.css', 'manifest.json']) await copyFile(path.join(process.env.OBSIDIAN_THEME_DIR, file), path.join(theme, file));
	await writeFile(path.join(vault, '.obsidian/appearance.json'), JSON.stringify({ cssTheme: name, accentColor: '#440acd', baseFontSize: 16 }));
}
const source = '# Runtime verification\n\n:::: {.variants #runtime view="columns" responsive="scroll"}\n::: First\nAlpha original.\n:::\n::: Second\n### Heading\n\nBeta comparison with **bold**.\n:::\n::::\n\nOutside.\n';
await writeFile(path.join(vault, 'Verification.md'), source);
console.log('Disposable test vault:', vault);
const application = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0'], { stdio: 'pipe' });
application.stderr.on('data', data => { if (data.toString().includes('DevTools listening')) console.log(data.toString().trim()); });
let browser;
try {
	let port;
	for (let attempt = 0; attempt < 100; attempt++) {
		try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch {}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	if (!port) throw new Error('Isolated Obsidian did not expose its test debugging port.');
	browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
	const context = browser.contexts()[0];
	const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 20000 });
	console.log('Window:', page.url(), await page.title());
	page.setDefaultTimeout(15000);
	// Quitting the disposable app can race Electron's before-unload dialog.
	// Handle that explicitly instead of Playwright's automatic dialog handler.
	page.on('dialog', dialog => { void dialog.accept().catch(() => {}); });
	page.on('pageerror', error => console.error('Renderer error:', error.message));
	page.on('console', message => { if (message.type() === 'error') console.error('Console:', message.text()); });
	await page.screenshot({ path: path.join(directory, 'startup.png') });
	const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
	await trust.waitFor({ state: 'visible' });
	await trust.click();
	await page.waitForFunction(() => window.app?.workspace?.layoutReady, undefined, { timeout: 20000 });
	await page.evaluate(async () => {
		app.vault.setConfig('showLineNumber', true);
		await app.plugins.setEnable(true);
		if (!app.plugins.plugins['section-variants']) await app.plugins.enablePlugin('section-variants');
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
	await page.waitForFunction(original => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Verification.md').view.editor.getValue() === original, source);
	await second.locator('p').click();
	await second.locator('.section-variants-column-editor .cm-content').waitFor({ state: 'visible' });
	if (!await first.locator('p').isVisible()) throw new Error('Previous column did not return to preview.');
	await page.keyboard.press('Escape');
	await page.locator('.section-variants-column-editor').waitFor({ state: 'detached' });
	console.log('PASS: real Obsidian click → in-column native editor → type → note update → undo → switch → Escape.');
	await verifyNativePreviews(page, directory);
} finally {
	application.kill('SIGTERM');
	// Only the subprocess created above: never find/terminate a user's app.
	await Promise.race([once(application, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
	if (application.exitCode === null && application.signalCode === null) application.kill('SIGKILL');
	await browser?.close();
}
