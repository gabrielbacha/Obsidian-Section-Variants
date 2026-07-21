import {
	Editor,
	FuzzySuggestModal,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
} from 'obsidian';
import { findBlockAtOffset, normalizeLabel, ViewMode } from './core/types';
import type SectionVariantsPlugin from './main';

const VIEW_ORDER: ViewMode[] = ['toggle', 'columns', 'auto'];

export function registerCommands(plugin: SectionVariantsPlugin): void {
	plugin.addCommand({
		id: 'insert-variants-block',
		name: 'Insert variants block',
		editorCallback: (editor) => plugin.openInsertModal(editor, editor.getCursor()),
	});
	registerCycleCommand(plugin, 'select-next-variant', 'Select next variant', 1, false);
	registerCycleCommand(plugin, 'select-previous-variant', 'Select previous variant', -1, false);
	registerCycleCommand(
		plugin,
		'apply-next-variant-across-note',
		'Apply next variant across note',
		1,
		true,
	);
	registerCycleCommand(
		plugin,
		'apply-previous-variant-across-note',
		'Apply previous variant across note',
		-1,
		true,
	);

	plugin.addCommand({
		id: 'open-global-variant-selector',
		name: 'Open global variant selector',
		checkCallback: (checking) => {
			const context = activeContext(plugin);
			if (!context || validBlocks(context.parsed).length === 0) return false;
			if (!checking) {
				const labels = unionLabels(validBlocks(context.parsed));
				new ValueSuggestModal(
					plugin,
					labels,
					'Select a label for matching blocks',
					(label) => {
						const result = plugin.store.applyLabelAcrossNote(
							context.path,
							context.parsed,
							label,
						);
						new Notice(
							`Applied to ${result.applied} block${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}.`,
						);
					},
				).open();
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'cycle-block-view',
		name: 'Cycle block view',
		editorCheckCallback: (checking, editor, view) => {
			const focused = focusedBlock(plugin, editor, view);
			if (!focused) return false;
			if (!checking) {
				const current = plugin.store.resolve(focused.path, focused.block).view;
				const index = VIEW_ORDER.indexOf(current);
				void setLocalViewWithIdentity(
					plugin,
					focused.path,
					focused.block,
					VIEW_ORDER[(index + 1) % VIEW_ORDER.length] ?? 'toggle',
				);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'apply-view-across-note',
		name: 'Apply view across note',
		checkCallback: (checking) => {
			const context = activeContext(plugin);
			if (!context || validBlocks(context.parsed).length === 0) return false;
			if (!checking) {
				new ValueSuggestModal(
					plugin,
					VIEW_ORDER,
					'Select a view for all blocks',
					(value) =>
						plugin.store.applyViewAcrossNote(
							context.path,
							context.parsed,
							value,
						),
				).open();
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'reset-focused-block',
		name: 'Reset focused block',
		editorCheckCallback: (checking, editor, view) => {
			const focused = focusedBlock(plugin, editor, view);
			if (!focused) return false;
			if (!checking) plugin.store.resetBlock(focused.path, focused.block);
			return true;
		},
	});

	plugin.addCommand({
		id: 'reset-all-blocks-to-defaults',
		name: 'Reset all blocks to defaults',
		checkCallback: (checking) => {
			const context = activeContext(plugin);
			if (!context || validBlocks(context.parsed).length === 0) return false;
			if (!checking) plugin.store.resetNote(context.path);
			return true;
		},
	});

	plugin.addCommand({
		id: 'toggle-sticky-note-control',
		name: 'Toggle sticky note control',
		checkCallback: (checking) => {
			const context = activeContext(plugin);
			if (!context) return false;
			if (!checking) {
				plugin.store.setStickyVisible(
					context.path,
					!plugin.store.isStickyVisible(context.path),
				);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'export-variants-to-html',
		name: 'Export variants to HTML',
		checkCallback: (checking) => {
			const context = activeContext(plugin);
			if (!context || validBlocks(context.parsed).length === 0) return false;
			if (!checking) plugin.openHtmlExport();
			return true;
		},
	});
}

function registerCycleCommand(
	plugin: SectionVariantsPlugin,
	id: string,
	name: string,
	direction: 1 | -1,
	acrossNote: boolean,
): void {
	plugin.addCommand({
		id,
		name,
		editorCheckCallback: (checking, editor, view) => {
			const focused = focusedBlock(plugin, editor, view);
			if (!focused) return false;
			if (checking) return true;
			const state = plugin.store.resolve(focused.path, focused.block);
			const current = focused.block.variants.findIndex(
				(variant) =>
					variant.normalizedLabel === normalizeLabel(state.selectedLabel),
			);
			const nextIndex =
				(current + direction + focused.block.variants.length) %
				focused.block.variants.length;
			const next = focused.block.variants[nextIndex];
			if (!next) return true;
			if (acrossNote) {
				const result = plugin.store.applyLabelAcrossNote(
					focused.path,
					focused.parsed,
					next.label,
				);
				new Notice(
					`Applied to ${result.applied} block${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}.`,
				);
			} else {
				void setLocalVariantWithIdentity(
					plugin,
					focused.path,
					focused.block,
					next.label,
				);
			}
			return true;
		},
	});
}

async function setLocalVariantWithIdentity(
	plugin: SectionVariantsPlugin,
	path: string,
	block: ReturnType<SectionVariantsPlugin['parse']>['blocks'][number],
	label: string,
): Promise<void> {
	const persistent = await plugin.ensurePersistentIdentity(path, block);
	if (!persistent) return;
	plugin.store.setSelectedLabel(path, persistent, label);
}

async function setLocalViewWithIdentity(
	plugin: SectionVariantsPlugin,
	path: string,
	block: ReturnType<SectionVariantsPlugin['parse']>['blocks'][number],
	view: ViewMode,
): Promise<void> {
	const persistent = await plugin.ensurePersistentIdentity(path, block);
	if (!persistent) return;
	plugin.store.setView(path, persistent, view);
}

function focusedBlock(
	plugin: SectionVariantsPlugin,
	editor: Editor,
	view: MarkdownView | MarkdownFileInfo,
) {
	const path = view.file?.path;
	if (!path) return undefined;
	const parsed = plugin.parse(editor.getValue());
	const block = findBlockAtOffset(parsed, editor.posToOffset(editor.getCursor()));
	return block?.valid ? { path, parsed, block } : undefined;
}

function activeContext(plugin: SectionVariantsPlugin) {
	const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	const path = view?.file?.path;
	if (!view || !path) return undefined;
	return { view, path, parsed: plugin.parse(view.editor.getValue()) };
}

function unionLabels(blocks: ReturnType<SectionVariantsPlugin['parse']>['blocks']): string[] {
	const seen = new Set<string>();
	const labels: string[] = [];
	for (const block of blocks) {
		for (const variant of block.variants) {
			if (seen.has(variant.normalizedLabel)) continue;
			seen.add(variant.normalizedLabel);
			labels.push(variant.label);
		}
	}
	return labels;
}

function validBlocks(parsed: ReturnType<SectionVariantsPlugin['parse']>) {
	return parsed.blocks.filter((block) => block.valid);
}

class ValueSuggestModal<T extends string> extends FuzzySuggestModal<T> {
	constructor(
		plugin: SectionVariantsPlugin,
		private readonly items: T[],
		placeholder: string,
		private readonly choose: (value: T) => void,
	) {
		super(plugin.app);
		this.setPlaceholder(placeholder);
	}

	getItems(): T[] {
		return this.items;
	}

	getItemText(item: T): string {
		return item.charAt(0).toUpperCase() + item.slice(1);
	}

	onChooseItem(item: T): void {
		this.choose(item);
	}
}
