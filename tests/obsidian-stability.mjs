// Opt-in stability test against an installed Obsidian, in an isolated vault:
// scroll anchoring, autosave while typing, Toggle layout, empty variants, and
// coexistence with common editing plugins. `SECTION_VARIANTS_PLUGINS_DIR`
// may point at a folder containing advanced-cursors, table-editor-obsidian
// and obsidian-linter; their release files are copied, never linked.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchObsidian, openLivePreview } from './obsidian-harness.mjs';

const paragraph = (seed, words) => Array.from({ length: words }, (_, i) => `word${(seed * 31 + i) % 97}`).join(' ') + '.';

function longNote() {
	const parts = ['# Long note', ''];
	for (let section = 0; section < 12; section++) {
		parts.push(`## Section ${section}`, '', paragraph(section, 40), '');
		parts.push(`:::: {.variants #cols-${section} view="columns"}`);
		for (const [index, label] of ['Short', 'Medium', 'Long'].entries()) {
			parts.push(`::: ${label}`);
			for (let p = 0; p <= index * 3 + 1; p++) parts.push(paragraph(section + p, 30 + index * 20), '');
			parts.push('- First point', '- Second point', '', '> [!note] Callout', '> Callout body.', ':::');
		}
		parts.push('::::', '', paragraph(section + 5, 25), '');
		parts.push(`:::: {.variants #toggle-${section}}`, '::: Alpha', `Toggle alpha body ${section}.`, '', paragraph(section, 20), '', '| A | B |', '| --- | --- |', '| 1 | 2 |', ':::', '::: Beta', 'Toggle beta body.', ':::', '::::', '');
	}
	return parts.join('\n');
}

const toggleNote = ':::: {.variants #typing}\n::: Alpha\nToggle alpha body.\n:::\n::: Beta\nBeta body.\n:::\n::::\n\nOutside line.\n';
const emptyNote = ':::: {.variants #empty}\n::: A\n:::\n::: B\nBeta body.\n:::\n::::\n';
const pluginsDir = process.env.SECTION_VARIANTS_PLUGINS_DIR;
const extraPlugins = pluginsDir ? ['advanced-cursors', 'table-editor-obsidian', 'obsidian-linter'].map(name => path.join(pluginsDir, name)) : [];

const { page, vault, errors, close } = await launchObsidian({
	files: { 'Long.md': longNote(), 'Typing.md': toggleNote, 'Empty.md': emptyNote },
	extraPlugins,
});
const noteValue = file => page.evaluate(file => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === file).view.editor.getValue(), file);
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); console.log(`${condition ? 'PASS' : 'FAIL'}: ${message}`); };

try {
	// 1. Content must not move on its own: not while a note opens at a
	// position, not after a scroll settles, and CodeMirror's height map must
	// match the rendered widgets (clicks land where they point).
	await openLivePreview(page, 'Long.md');
	const coldOpen = await page.evaluate(async () => {
		const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Long.md').view;
		const cm = view.editor.cm;
		const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
		const target = view.editor.getValue().indexOf('## Section 8');
		view.editor.scrollIntoView({ from: view.editor.offsetToPos(target), to: view.editor.offsetToPos(target) }, true);
		const lineTop = () => {
			const { node } = cm.domAtPos(target);
			const line = (node.nodeType === 1 ? node : node.parentElement)?.closest('.cm-line');
			return line?.isConnected ? line.getBoundingClientRect().top : undefined;
		};
		await sleep(60);
		const first = lineTop();
		const samples = [];
		for (let i = 0; i < 15; i++) { await sleep(100); samples.push(lineTop()); }
		const moves = samples.filter(top => top !== undefined && first !== undefined).map(top => Math.abs(top - first));
		return { first, worst: Math.max(0, ...moves), missing: first === undefined };
	});
	console.log('Open at position:', JSON.stringify(coldOpen));
	check(!coldOpen.missing && coldOpen.worst <= 2, `a heading stays in place while the note renders (moved ${coldOpen.worst.toFixed(1)}px)`);
	const scroll = await page.evaluate(async () => {
		const cm = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Long.md').view.editor.cm;
		const scroller = cm.scrollDOM;
		const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
		const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		scroller.scrollTop = scroller.scrollHeight;
		await sleep(800);
		const scrollErrors = [];
		const settleErrors = [];
		const mapErrors = [];
		for (let step = 0; step < 60 && scroller.scrollTop > 0; step++) {
			const rect = scroller.getBoundingClientRect();
			const anchor = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
				?.closest('.cm-line, .cm-embed-block, .section-variants-live-widget, .section-variants-native-end');
			const requested = Math.min(300, scroller.scrollTop);
			const before = anchor?.getBoundingClientRect().top;
			scroller.scrollTop -= requested;
			await frames(); await sleep(60);
			const scrolled = anchor?.isConnected ? anchor.getBoundingClientRect().top : undefined;
			if (scrolled !== undefined && before !== undefined) scrollErrors.push(Math.abs(scrolled - before - requested));
			await sleep(500);
			if (anchor?.isConnected && scrolled !== undefined) settleErrors.push(Math.abs(anchor.getBoundingClientRect().top - scrolled));
			// Every rendered line's height-map position must match the DOM.
			for (const line of cm.contentDOM.querySelectorAll(':scope > .cm-line')) {
				const pos = cm.posAtDOM(line);
				mapErrors.push(Math.abs(cm.documentTop + cm.lineBlockAt(pos).top - line.getBoundingClientRect().top));
			}
		}
		const summary = list => ({ worst: Math.max(0, ...list), bad: list.filter(error => error > 2).length, count: list.length });
		return { scroll: summary(scrollErrors), settle: summary(settleErrors), map: summary(mapErrors) };
	});
	console.log('Scrolling:', JSON.stringify(scroll));
	check(scroll.scroll.count > 10 && scroll.scroll.bad === 0, `scrolling up moves content only by the scrolled amount (worst ${scroll.scroll.worst.toFixed(1)}px)`);
	check(scroll.settle.bad === 0, `content stays still after each scroll (worst ${scroll.settle.worst.toFixed(1)}px)`);
	check(scroll.map.bad === 0, `the editor height map matches rendered lines (worst ${scroll.map.worst.toFixed(1)}px over ${scroll.map.count} lines)`);

	// 2. Toggle blocks: no collapsed lines, and each frame spans its block.
	await page.evaluate(() => {
		const editor = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Long.md').view.editor;
		const position = editor.offsetToPos(editor.getValue().indexOf(':::: {.variants #toggle-3}'));
		editor.scrollIntoView({ from: position, to: position }, true);
	});
	await page.waitForTimeout(400);
	const layout = await page.evaluate(() => {
		const cm = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Long.md').view.editor.cm;
		const collapsed = [...cm.contentDOM.querySelectorAll('.cm-line')].filter(line => line.getBoundingClientRect().height < 2).length;
		const header = cm.contentDOM.querySelector(`.section-variants-live-toolbar[data-block-from="${cm.state.doc.toString().indexOf(':::: {.variants #toggle-3}')}"]`);
		const end = header && cm.contentDOM.querySelector(`.section-variants-native-end[data-block-from="${header.dataset.blockFrom}"]`);
		const frames = [...cm.dom.querySelectorAll('.section-variants-native-frame')].map(frame => frame.getBoundingClientRect());
		const top = header?.getBoundingClientRect().top;
		const bottom = end?.getBoundingClientRect().bottom;
		const frame = frames.find(rect => Math.abs(rect.top - top) < 3);
		return { collapsed, frames: frames.length, topGap: frame ? frame.top - top : null, bottomGap: frame ? frame.bottom - bottom : null };
	});
	console.log('Toggle layout:', JSON.stringify(layout));
	check(layout.collapsed === 0, 'Toggle blocks leave no collapsed editor lines');
	check(layout.frames > 0 && layout.topGap !== null && layout.bottomGap !== null && Math.abs(layout.topGap) <= 2 && Math.abs(layout.bottomGap) <= 2, 'Toggle frame spans exactly from header to footer');

	// 3. Typing continuously while Obsidian autosaves keeps every keystroke.
	await openLivePreview(page, 'Typing.md');
	await page.locator('.section-variants-live-toolbar').first().waitFor({ state: 'visible' });
	await page.evaluate(() => {
		const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Typing.md').view;
		const offset = view.editor.getValue().indexOf('Toggle alpha body.') + 'Toggle alpha body.'.length;
		view.editor.focus();
		view.editor.setCursor(view.editor.offsetToPos(offset));
	});
	const typed = ' KEEPALLOFTHESECHARACTERSWHILESAVING';
	const saving = page.evaluate(async () => {
		const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Typing.md').view;
		for (let i = 0; i < 16; i++) { await view.save(); await new Promise(resolve => setTimeout(resolve, 70)); }
	});
	await page.keyboard.type(typed, { delay: 30 });
	await saving;
	await page.waitForTimeout(800);
	const afterTyping = await noteValue('Typing.md');
	check(afterTyping.includes(`Toggle alpha body.${typed}`), 'typing during autosave keeps every keystroke');
	await page.evaluate(async () => { await app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Typing.md').view.save(); });
	check(await readFile(path.join(vault, 'Typing.md'), 'utf8') === afterTyping, 'the saved file equals the editor');
	check(!(await readdir(vault)).includes('Section Variants Conflicts'), 'no conflict copies are created');

	// 4. Other origins pass; direct user edits into hidden syntax are still blocked.
	const origins = await page.evaluate(() => {
		const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Typing.md').view;
		const cm = view.editor.cm;
		const source = cm.state.doc.toString();
		const fence = source.indexOf('::: Beta');
		const attempt = userEvent => {
			const before = cm.state.doc.toString();
			cm.dispatch({ changes: { from: fence, to: fence + 3, insert: '---' }, userEvent });
			const changed = cm.state.doc.toString() !== before;
			if (changed) cm.dispatch({ changes: { from: fence, to: fence + 3, insert: ':::' } });
			return changed;
		};
		return { typed: attempt('input.type'), plugin: attempt('plugin.format'), set: attempt('set') };
	});
	check(!origins.typed, 'typing over a hidden fence is still rejected');
	check(origins.plugin && origins.set, 'plugin and Obsidian `set` edits are never rejected');

	// 5. Multi-cursor typing inside a variant and outside the block.
	await page.evaluate(() => {
		const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Typing.md').view;
		const source = view.editor.getValue();
		const inside = source.indexOf('Toggle alpha body.');
		const outside = source.indexOf('Outside line.');
		view.editor.focus();
		const Selection = view.editor.cm.state.selection.constructor;
		view.editor.cm.dispatch({ selection: Selection.create([Selection.cursor(inside), Selection.cursor(outside)]) });
	});
	await page.keyboard.type('Z');
	const multi = await noteValue('Typing.md');
	check(multi.includes('ZToggle alpha body.') && multi.includes('ZOutside line.'), 'multi-cursor typing edits every cursor');

	// 6. An empty Toggle variant offers a line to write in.
	await openLivePreview(page, 'Empty.md');
	await page.getByRole('button', { name: 'Write in A' }).click();
	await page.keyboard.type('hello');
	check((await noteValue('Empty.md')).startsWith(':::: {.variants #empty}\n::: A\nhello\n:::\n'), 'an empty variant gets its own first line');

	// 7. Common editing plugins work inside variants.
	if (extraPlugins.length) {
		await openLivePreview(page, 'Long.md');
		await page.locator('.section-variants-panel').first().waitFor({ state: 'visible' });
		const table = await page.evaluate(async () => {
			const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Long.md').view;
			const source = view.editor.getValue();
			const offset = source.indexOf('| 1 | 2 |') + 2;
			view.editor.setCursor(view.editor.offsetToPos(offset));
			const before = view.editor.getValue();
			app.commands.executeCommandById('table-editor-obsidian:insert-row');
			await new Promise(resolve => setTimeout(resolve, 300));
			const after = view.editor.getValue();
			return { changed: before !== after, blocks: app.plugins.plugins['section-variants'].parse(after).blocks.filter(block => block.valid).length };
		});
		check(table.changed && table.blocks === 24, 'Table Editor inserts a row inside an active Toggle variant');
		const cursors = await page.evaluate(async () => {
			const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Long.md').view;
			const source = view.editor.getValue();
			const from = source.indexOf('Toggle alpha body 0.');
			view.editor.setSelection(view.editor.offsetToPos(from), view.editor.offsetToPos(from + 'Toggle'.length));
			app.commands.executeCommandById('advanced-cursors:add-next-match-to-selections');
			await new Promise(resolve => setTimeout(resolve, 200));
			return view.editor.listSelections().length;
		});
		check(cursors === 2, 'Advanced Cursors adds the next match inside another Toggle variant');
		const lint = await page.evaluate(async () => {
			const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'Long.md').view;
			const before = view.editor.getValue();
			view.editor.setValue(before.replace('Toggle alpha body 1.', 'Toggle alpha body 1.   '));
			app.commands.executeCommandById('obsidian-linter:lint-file');
			await new Promise(resolve => setTimeout(resolve, 1500));
			const after = view.editor.getValue();
			return { blocks: app.plugins.plugins['section-variants'].parse(after).blocks.filter(block => block.valid).length };
		});
		check(lint.blocks === 24, 'Linter runs on a variants note and every block stays valid');
	} else {
		console.log('SKIP: set SECTION_VARIANTS_PLUGINS_DIR to test Table Editor, Advanced Cursors and Linter.');
	}

	const pluginErrors = errors.filter(message => /section-variants|Section Variants/iu.test(message));
	check(pluginErrors.length === 0, `no Section Variants renderer errors${pluginErrors.length ? `: ${pluginErrors.join(' | ')}` : ''}`);
} finally {
	await close();
}
if (failures.length) {
	console.error(`${failures.length} stability check(s) failed.`);
	process.exitCode = 1;
}
