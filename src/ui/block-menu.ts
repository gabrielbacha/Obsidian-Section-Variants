import { Notice } from 'obsidian';
import {
	effectiveAuthoredLabel,
	effectiveAuthoredView,
	VariantBlock,
} from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { BLOCK_MENU_ACTIONS } from './block-menu-actions';
import { AttachedMenuItem, openAttachedMenu } from './attached-menu';

export function openBlockMenu(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	event: MouseEvent,
): void {
	const origin = event.currentTarget as HTMLElement | null;
	const renameItems: AttachedMenuItem[] = block.variants.map((variant) => ({
		label: variant.label,
		onSelect: () => host.openRenameVariant(path, block, variant.label, origin ?? undefined),
	}));
	const deleteItems: AttachedMenuItem[] = block.variants.map((variant) => ({
		label: variant.label,
		warning: true,
		onSelect: () => host.openDeleteVariant(path, block, variant.label, origin ?? undefined),
	}));
	openAttachedMenu(event, [
		{
			label: BLOCK_MENU_ACTIONS[0],
			icon: 'plus',
			onSelect: () => host.openAddVariant(path, block, origin ?? undefined),
		},
		{
			label: BLOCK_MENU_ACTIONS[1],
			icon: 'text-cursor-input',
			children: renameItems,
		},
		{
			label: BLOCK_MENU_ACTIONS[2],
			icon: 'trash-2',
			warning: true,
			disabled: block.variants.length <= 1,
			children: deleteItems,
		},
		{ label: '-' },
		{
			label: BLOCK_MENU_ACTIONS[3],
			icon: 'settings-2',
			onSelect: () => host.openBlockConfiguration(path, block, origin ?? undefined),
		},
		{
			label: BLOCK_MENU_ACTIONS[4],
			icon: 'combine',
			onSelect: () => {
				const followed = host.store.followGlobalState(path, block);
				if (!followed.label && !followed.view) {
					new Notice('No compatible global label or global view is set.');
				}
			},
		},
		{
			label: BLOCK_MENU_ACTIONS[5],
			icon: 'rotate-ccw',
			onSelect: () => host.store.resetBlock(path, block),
		},
	]);
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
