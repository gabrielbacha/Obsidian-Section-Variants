// Launch an installed Obsidian against a disposable vault and profile.
// Never opens, modifies, or closes the user's existing vault/window.
import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * `extraPlugins` are plugin folders whose release files are copied (never
 * linked or written back) into the disposable vault with default settings.
 * @param {{ files: Record<string, string>, app?: object, extraPlugins?: string[] }} options
 * @returns {Promise<{ page: import('@playwright/test').Page, vault: string, directory: string, errors: string[], close(): Promise<void> }>}
 */
export async function launchObsidian({ files, app = {}, extraPlugins = [] }) {
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
	await writeFile(path.join(vault, '.obsidian/app.json'), JSON.stringify({ livePreview: true, ...app }));
	const pluginIds = ['section-variants'];
	for (const source of extraPlugins) {
		const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
		const target = path.join(vault, '.obsidian/plugins', manifest.id);
		await mkdir(target, { recursive: true });
		for (const name of ['main.js', 'manifest.json', 'styles.css']) {
			await copyFile(path.join(source, name), path.join(target, name)).catch(error => {
				if (name !== 'styles.css') throw error;
			});
		}
		pluginIds.push(manifest.id);
	}
	await writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(pluginIds));
	if (process.env.OBSIDIAN_THEME_DIR) {
		const name = path.basename(process.env.OBSIDIAN_THEME_DIR);
		const theme = path.join(vault, '.obsidian/themes', name);
		await mkdir(theme, { recursive: true });
		for (const file of ['theme.css', 'manifest.json']) await copyFile(path.join(process.env.OBSIDIAN_THEME_DIR, file), path.join(theme, file));
		await writeFile(path.join(vault, '.obsidian/appearance.json'), JSON.stringify({ cssTheme: name, accentColor: '#440acd', baseFontSize: 16 }));
	}
	for (const [name, content] of Object.entries(files)) await writeFile(path.join(vault, name), content);
	console.log('Disposable test vault:', vault);
	const args = [
		`--user-data-dir=${profile}`,
		'--remote-debugging-port=0',
		// A hidden window must keep rendering and running timers normally.
		'--disable-renderer-backgrounding',
		'--disable-background-timer-throttling',
		'--disable-backgrounding-occluded-windows',
	];
	// On macOS, start the test app hidden and without taking focus, so it never
	// interrupts the user. SECTION_VARIANTS_TEST_VISIBLE=1 shows it instead.
	const bundle = executable.match(/^(.*?\.app)\//u)?.[1];
	const background = process.platform === 'darwin' && bundle && !process.env.SECTION_VARIANTS_TEST_VISIBLE;
	if (background) spawn('open', ['-g', '-j', '-n', '-a', bundle, '--args', ...args], { stdio: 'ignore' });
	else spawn(executable, args, { stdio: 'ignore' });
	let browser;
	const errors = [];
	const close = async () => {
		await browser?.close().catch(() => {});
		// Only processes started with this run's unique temporary profile:
		// never find or terminate the user's own Obsidian.
		const pids = async () => {
			try {
				const { stdout } = await promisify(execFile)('pgrep', ['-f', '--', `--user-data-dir=${profile}`]);
				return stdout.split('\n').filter(Boolean).map(Number);
			} catch { return []; }
		};
		for (const pid of await pids()) { try { process.kill(pid, 'SIGTERM'); } catch {} }
		await new Promise(resolve => setTimeout(resolve, 1500));
		for (const pid of await pids()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
	};
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
		// The hidden window never has OS focus; let the page behave as focused.
		const session = await context.newCDPSession(page);
		await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
		// Quitting the disposable app can race Electron's before-unload dialog.
		// Handle that explicitly instead of Playwright's automatic dialog handler.
		page.on('dialog', dialog => { void dialog.accept().catch(() => {}); });
		page.on('pageerror', error => { errors.push(error.message); console.error('Renderer error:', error.message); });
		page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error('Console:', message.text()); } });
		const trust = page.getByRole('button', { name: 'Trust author and enable plugins', exact: true });
		await trust.waitFor({ state: 'visible' });
		await trust.click();
		await page.waitForFunction(() => window.app?.workspace?.layoutReady, undefined, { timeout: 20000 });
		await page.evaluate(async ids => {
			await app.plugins.setEnable(true);
			for (const id of ids) if (!app.plugins.enabledPlugins.has(id)) await app.plugins.enablePlugin(id);
		}, pluginIds);
		return { page, vault, directory, errors, close };
	} catch (error) {
		await close();
		throw error;
	}
}

/** Open a note in Live Preview in the current leaf. */
export async function openLivePreview(page, file) {
	await page.evaluate(async file => {
		const leaf = app.workspace.getLeaf();
		await leaf.openFile(app.vault.getAbstractFileByPath(file));
		await leaf.setViewState({ type: 'markdown', state: { file, mode: 'source', source: false } });
	}, file);
}
