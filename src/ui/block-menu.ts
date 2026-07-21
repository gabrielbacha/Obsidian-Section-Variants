import { Menu, Notice } from 'obsidian';
import {
	effectiveAuthoredLabel,
	effectiveAuthoredView,
	VariantBlock,
} from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { BLOCK_MENU_ACTIONS } from './block-menu-actions';

export function openBlockMenu(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	event: MouseEvent,
): void {
	const menu = new Menu();
	menu.addItem((item) =>
		item.setTitle(BLOCK_MENU_ACTIONS[0]).setIcon('combine').onClick(() => {
			const followed = host.store.followGlobalState(path, block);
			if (!followed.label && !followed.view) {
				new Notice('No compatible global label or global view is set.');
			}
		}),
	);
	menu.addItem((item) =>
		item.setTitle(BLOCK_MENU_ACTIONS[1]).setIcon('rotate-ccw').onClick(() => {
			host.store.resetBlock(path, block);
		}),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item.setTitle(BLOCK_MENU_ACTIONS[2]).setIcon('settings-2').onClick(() => {
			host.openBlockConfiguration(path, block);
		}),
	);
	menu.addItem((item) =>
		item.setTitle(BLOCK_MENU_ACTIONS[3]).setIcon('text-cursor-input').onClick(() => {
			host.openRenameVariant(path, block);
		}),
	);
	menu.showAtMouseEvent(event);
}

export function blockMarkerTooltip(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
): string {
	const state = host.store.resolve(path, block);
	const current = `${state.selectedLabel} · ${viewLabel(state.view)}`;
	if (!state.differsFromAuthored) return current;
	return `${current} · default ${effectiveAuthoredLabel(block)} / ${viewLabel(
		effectiveAuthoredView(block, host.store.settings.defaultView),
	)}`;
}

function viewLabel(view: string): string {
	return view.charAt(0).toUpperCase() + view.slice(1);
}
