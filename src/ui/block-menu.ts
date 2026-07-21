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
		item.setTitle(BLOCK_MENU_ACTIONS[3]).setIcon('plus').onClick(() => {
			host.openAddVariant(path, block);
		}),
	);
	menu.addItem((item) =>
		item
			.setTitle(`${BLOCK_MENU_ACTIONS[4]} ›`)
			.setIcon('trash-2')
			.setDisabled(block.variants.length <= 2)
			.setWarning(true)
			.onClick((submenuEvent) => {
				openVariantSubmenu(block, submenuEvent, (label) => {
					host.openDeleteVariant(path, block, label);
				});
			}),
	);
	menu.addItem((item) =>
		item
			.setTitle(`${BLOCK_MENU_ACTIONS[5]} ›`)
			.setIcon('text-cursor-input')
			.onClick((submenuEvent) => {
				openVariantSubmenu(block, submenuEvent, (label) => {
					host.openRenameVariant(path, block, label);
				});
			}),
	);
	menu.showAtMouseEvent(event);
}

function openVariantSubmenu(
	block: VariantBlock,
	event: MouseEvent | KeyboardEvent,
	onSelect: (label: string) => void,
): void {
	const submenu = new Menu();
	for (const variant of block.variants) {
		submenu.addItem((item) =>
			item.setTitle(variant.label).onClick(() => onSelect(variant.label)),
		);
	}
	const target = event.currentTarget as HTMLElement | null;
	const rect = target?.getBoundingClientRect();
	const mouseX = 'clientX' in event ? event.clientX : 0;
	const mouseY = 'clientY' in event ? event.clientY : 0;
	submenu.showAtPosition(
		{
			x: mouseX || rect?.right || 0,
			y: mouseY || rect?.top || 0,
		},
		target?.ownerDocument,
	);
}

export function blockMarkerTooltip(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
): string {
	const state = host.store.resolve(path, block);
	const current = `${block.attributes.name ? `${block.attributes.name} · ` : ''}${state.selectedLabel} · ${viewLabel(state.view)}`;
	if (!state.differsFromAuthored) return current;
	return `${current} · default ${effectiveAuthoredLabel(block)} / ${viewLabel(
		effectiveAuthoredView(block, host.store.settings.defaultView),
	)}`;
}

function viewLabel(view: string): string {
	return view.charAt(0).toUpperCase() + view.slice(1);
}
