import {ActionModal} from '../ui/action-modal';
import type {StateSnapshot} from '../state/store';
import {
	Component,
	MarkdownRenderer,
	Notice,
	normalizePath,
	Setting,
	TFile,
} from 'obsidian';
import {
	ParsedNote,
	VariantBlock,
	VariantSection,
} from '../core/types';
import { defaultHtmlExportPath } from '../core/serializer';
import { SectionVariantsHost } from '../plugin-host';
import { ExportState, selectExportVariants } from './selection';
import { visibleColumnWidths, parseColumnRatios } from '../core/column-ratios';


interface ExportHost {app:SectionVariantsHost['app'];store:StateSnapshot;}

export class HtmlExportModal extends ActionModal {
	private outputPath: string;
	private state: ExportState;
	private errorEl?: HTMLElement;

	constructor(
		private readonly host: SectionVariantsHost,
		private readonly file: TFile,
		private readonly readSource?:()=>string|Promise<string>,
	) {
		super(host.app);
		this.outputPath = defaultHtmlExportPath(file.path);
		this.state = host.store.settings.exportState;
	}

	onOpen(): void {
		this.setTitle('Export variants to HTML');
		new Setting(this.contentEl)
			.setName('State')
			.setDesc('Authored defaults ignore temporary UI state.')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						authored: 'Authored defaults',
						current: 'Current UI state',
					})
					.setValue(this.state)
					.onChange((value) => {
						this.state = value as ExportState;
					}),
			);
		new Setting(this.contentEl)
			.setName('Vault output path')
			.setDesc('Existing files are not overwritten; a numeric suffix is added when needed.')
			.addText((text) =>
				text.setValue(this.outputPath).onChange((value) => {
					this.outputPath = value.trim();
				}),
			);
		this.errorEl = this.contentEl.createDiv({ cls: 'section-variants-modal-error' });
		this.errorEl.setAttribute('role', 'alert');
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText('Export')
					.setCta()
					.onClick(() => void this.export()),
			);
	}

	onClose(): void {
		this.closedSubmission();
		this.contentEl.empty();
	}

	private async export(): Promise<void> {
		if (!this.outputPath) {
			this.errorEl?.setText('Choose an output path.');
			return;
		}
		const mode=this.state,outputPath=this.outputPath,snapshot=this.host.store.snapshot(),fileSnapshot={path:this.file.path,basename:this.file.basename};
		await this.perform(async()=>{
			const source=this.readSource?await this.readSource():await this.host.app.vault.cachedRead(this.file);
			const host:ExportHost={app:this.host.app,store:snapshot};
			const html=await renderHtmlDocument(host,fileSnapshot,source,this.host.parse(source),mode);
			const path=await uniqueHtmlPath(this.host,outputPath);await this.host.app.vault.create(path,html);
			const created=this.host.app.vault.getAbstractFileByPath(path);
			if(created instanceof TFile&&!this.isSubmissionClosed())try{await this.host.app.workspace.getLeaf(false).openFile(created);}catch{new Notice('HTML was created, but Obsidian could not open it.');}
		},this.errorEl);
	}
}

export async function renderHtmlDocument(
	host: ExportHost,
	file: Pick<TFile,'path'|'basename'>,
	source: string,
	parsed: ParsedNote,
	state: ExportState,
): Promise<string> {
	const component = new Component();
	component.load();
	const root = createEl('main');
	root.addClass('section-variants-export');
	try {
		let cursor = 0;
		for (const block of parsed.roots) {
			if (!block.valid) continue;
			if (block.range.from > cursor) {
				await renderMarkdown(
					host,
					file.path,
					source.slice(cursor, block.range.from),
					root,
					component,
				);
			}
			await renderExportBlock(host, file.path, source, block, root, component, state);
			cursor = block.range.to;
		}
		if (cursor < source.length) {
			await renderMarkdown(
				host,
				file.path,
				source.slice(cursor),
				root,
				component,
			);
		}
		const body = new XMLSerializer().serializeToString(root);
		return [
			'<!doctype html>',
			'<html lang="en">',
			'<head>',
			'<meta charset="utf-8">',
			'<meta name="viewport" content="width=device-width, initial-scale=1">',
			`<title>${escapeHtml(file.basename)}</title>`,
			`<style>${exportCss(host.store.settings.defaultMinWidth)}</style>`,
			'</head>',
			`<body>${body}</body>`,
			'</html>',
		].join('\n');
	} finally {
		component.unload();
	}
}

async function renderExportBlock(
	host: ExportHost,
	path: string,
	source: string,
	block: VariantBlock,
	target: HTMLElement,
	component: Component,
	stateMode: ExportState,
): Promise<void> {
	const current = host.store.resolve(path, block);
	const selection = selectExportVariants(
		block,
		current,
		stateMode,
		host.store.settings.defaultView,
	);
	const view = selection.view;
	const wrapper = target.createDiv({
		cls: `section-variants-export-block section-variants-export-${view}`,
	});
	wrapper.dataset.responsive = selection.responsive;
	wrapper.style.setProperty('--sv-count', String(Math.max(1, selection.variants.length)));
	if (CSS.supports('width', selection.minWidth)) wrapper.style.setProperty('--sv-min-width', selection.minWidth);
	const indexes = selection.variants.map(variant => block.variants.indexOf(variant));
	const widths = visibleColumnWidths(selection.widths, block.variants.length, indexes);
	if (widths && !/[;{}]/u.test(widths) && CSS.supports('grid-template-columns', widths)) {
		const ratios = parseColumnRatios(widths, selection.variants.length);
		const exportedWidths = selection.responsive === 'scroll' && ratios && CSS.supports('width', selection.minWidth)
			? ratios.map(ratio => `minmax(${selection.minWidth}, ${ratio}fr)`).join(' ') : widths;
		wrapper.style.setProperty('--sv-widths', exportedWidths);
	}
	if (block.attributes.name) {
		wrapper.createEl('h1', {
			cls: 'section-variants-export-name',
			text: block.attributes.name,
		});
	}
	for (const variant of selection.variants) {
		const panel = wrapper.createEl('section');
		panel.createEl('h2', { text: variant.label });
		await renderVariant(host, path, source, variant, panel, component, stateMode);
	}
}

async function renderVariant(
	host: ExportHost,
	path: string,
	source: string,
	variant: VariantSection,
	target: HTMLElement,
	component: Component,
	state: ExportState,
): Promise<void> {
	let cursor = variant.content.from;
	for (const child of [...variant.children].sort(
		(left, right) => left.range.from - right.range.from,
	)) {
		if (child.range.from > cursor) {
			await renderMarkdown(
				host,
				path,
				source.slice(cursor, child.range.from),
				target,
				component,
			);
		}
		await renderExportBlock(host, path, source, child, target, component, state);
		cursor = child.range.to;
	}
	if (cursor < variant.content.to) {
		await renderMarkdown(
			host,
			path,
			source.slice(cursor, variant.content.to),
			target,
			component,
		);
	}
}

async function renderMarkdown(
	host: ExportHost,
	path: string,
	markdown: string,
	target: HTMLElement,
	component: Component,
): Promise<void> {
	if (!markdown.trim()) return;
	await MarkdownRenderer.render(host.app, markdown, target, path, component);
}

async function uniqueHtmlPath(
	host: ExportHost,
	requested: string,
): Promise<string> {
	const normalized = normalizePath(
		requested.toLowerCase().endsWith('.html') ? requested : `${requested}.html`,
	);
	if (!host.app.vault.getAbstractFileByPath(normalized)) return normalized;
	const stem = normalized.replace(/\.html$/iu, '');
	let index = 2;
	while (host.app.vault.getAbstractFileByPath(`${stem} ${index}.html`)) index += 1;
	return `${stem} ${index}.html`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/gu, '&amp;')
		.replace(/</gu, '&lt;')
		.replace(/>/gu, '&gt;')
		.replace(/"/gu, '&quot;');
}

/**
 * Standalone document styles. Honours the reader's colour scheme rather than
 * forcing light, and takes the column width from the user's setting.
 */
function exportCss(minColumnWidth: string): string {
	return `
:root { color-scheme: light dark; --sv-fg: #222; --sv-bg: #fff; --sv-rule: #ccc; --sv-muted: #666; }
@media (prefers-color-scheme: dark) {
  :root { --sv-fg: #ddd; --sv-bg: #1e1e1e; --sv-rule: #3a3a3a; --sv-muted: #999; }
}
body { margin: 0 auto; max-width: 72rem; padding: 2rem; color: var(--sv-fg); background: var(--sv-bg); font: 16px/1.55 system-ui, sans-serif; }
.section-variants-export-block { margin: 1.5rem 0; }
.section-variants-export-name { grid-column: 1 / -1; margin: 0 0 .5rem; font-size: 1rem; }
.section-variants-export-columns, .section-variants-export-auto { display: grid; grid-template-columns: var(--sv-widths, repeat(auto-fit, minmax(min(100%, var(--sv-min-width, ${minColumnWidth})), 1fr))); gap: 1.5rem; }
.section-variants-export-columns[data-responsive="stack"] { grid-template-columns: 1fr; }
.section-variants-export-columns[data-responsive="scroll"] { grid-template-columns: var(--sv-widths, repeat(var(--sv-count, 1), minmax(var(--sv-min-width, ${minColumnWidth}), 1fr))); overflow-x: auto; }
.section-variants-export-block > section { min-width: 0; }
.section-variants-export-columns > section + section, .section-variants-export-auto > section + section { padding-left: 1.5rem; border-left: 1px solid var(--sv-rule); }
.section-variants-export-block > section > h2:first-child { margin-top: 0; color: var(--sv-muted); font-size: .75rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
img { max-width: 100%; height: auto; }
pre { overflow: auto; }
a { color: inherit; }
@media (max-width: 42rem) {
  body { padding: 1rem; }
  .section-variants-export-columns[data-responsive="responsive"] { grid-template-columns: 1fr; }
  .section-variants-export-columns > section + section, .section-variants-export-auto > section + section { padding-left: 0; border-left: 0; }
}
`;
}
