import { Menu, Notice } from 'obsidian';
import {
	effectiveAuthoredLabel,
	effectiveAuthoredView,
	VariantBlock,
	ViewMode,
} from '../core/types';
import { SectionVariantsHost } from '../plugin-host';

const VIEW_ITEMS: ReadonlyArray<{
	value: ViewMode;
	label: string;
	icon: string;
}> = [
	{ value: 'toggle', label: 'Show one variant', icon: 'rows-2' },
	{ value: 'columns', label: 'Compare in columns', icon: 'columns-2' },
	{ value: 'auto', label: 'Choose view automatically', icon: 'wand-2' },
];

export interface BlockMenuOptions {
	onDoneEditing?: () => void;
}

export function openBlockMenu(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	event: MouseEvent,
	options: BlockMenuOptions = {},
): void {
	const state = host.store.resolve(path, block);
	const menu = new Menu();

	if (options.onDoneEditing) {
		menu.addItem((item) =>
			item.setTitle('Done editing').setIcon('check').onClick(() => {
				options.onDoneEditing?.();
			}),
		);
		menu.addSeparator();
	}

	for (const view of VIEW_ITEMS) {
		menu.addItem((item) =>
			item
				.setTitle(view.label)
				.setIcon(view.icon)
				.setChecked(state.view === view.value)
				.onClick(async () => {
					const persistent = await host.ensurePersistentIdentity(path, block);
					if (!persistent) return;
					host.store.setView(path, persistent, view.value);
				}),
		);
	}

	menu.addSeparator();
	menu.addItem((item) =>
		item.setTitle('Follow global state').setIcon('combine').onClick(() => {
			const followed = host.store.followGlobalState(path, block);
			if (!followed.label && !followed.view) {
				new Notice('No compatible global label or global view is set.');
			}
		}),
	);
	menu.addItem((item) =>
		item.setTitle('Reset this block').setIcon('rotate-ccw').onClick(() => {
			host.store.resetBlock(path, block);
		}),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item.setTitle('Configure authored defaults').setIcon('settings-2').onClick(() => {
			host.openBlockConfiguration(path, block);
		}),
	);
	menu.addItem((item) =>
		item.setTitle('Rename a variant').setIcon('text-cursor-input').onClick(() => {
			host.openRenameVariant(path, block);
		}),
	);
	menu.addItem((item) =>
		item.setTitle('Save current column visibility').setIcon('eye').onClick(() => {
			host.store.saveHidden(path, block);
		}),
	);
	for (const variant of block.variants) {
		if (!state.hiddenLabels.has(variant.normalizedLabel)) continue;
		menu.addItem((item) =>
			item.setTitle(`Show ${variant.label}`).setIcon('eye').onClick(() => {
				host.store.toggleHidden(path, block, variant.label);
			}),
		);
	}
	if (!block.attributes.id && !block.blockId) {
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle('Add stable block ID').setIcon('fingerprint').onClick(() => {
				void host.addStableBlockId(path, block);
			}),
		);
	}

	const authoredLabel = effectiveAuthoredLabel(block);
	const authoredView = effectiveAuthoredView(block, host.store.settings.defaultView);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(`Default: ${authoredLabel}, ${authoredView}`)
			.setIcon('info')
			.setDisabled(true),
	);
	menu.showAtMouseEvent(event);
}

export function blockMarkerTooltip(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
): string {
	const state = host.store.resolve(path, block);
	return [
		`Current variant: ${state.selectedLabel}`,
		`Default variant: ${effectiveAuthoredLabel(block)}`,
		`Current view: ${state.view}`,
		`Default view: ${effectiveAuthoredView(block, host.store.settings.defaultView)}`,
	].join('\n');
}
