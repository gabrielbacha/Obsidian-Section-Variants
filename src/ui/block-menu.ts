import {
	effectiveAuthoredLabel,
	effectiveAuthoredView,
	normalizeLabel,
	VariantBlock,
} from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import {
	BLOCK_MENU_ACTIONS,
	NARROW_LAYOUT_OPTIONS,
} from './block-menu-actions';
import { AttachedMenuItem, openAttachedMenu } from './attached-menu';

export function openBlockMenu(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	event: MouseEvent,
): void {
	const origin = event.currentTarget as HTMLElement | null;
	const followingGlobal = host.store.isFollowingGlobalState(path, block);
	const state = host.store.resolve(path, block);
	const responsive = block.attributes.responsive ?? 'responsive';
	const authoredLabel = effectiveAuthoredLabel(block);
	const authoredView = effectiveAuthoredView(
		block,
		host.store.settings.defaultView,
	);
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
			icon: 'text-cursor-input',
			children: [
				{
					label: 'Box name',
					input: {
						value: block.attributes.name ?? '',
						placeholder: 'No box name',
						ariaLabel: 'Box name',
						onSubmit: (value) => host.setBlockName(
							path,
							block,
							value,
							origin ?? undefined,
						),
					},
				},
			],
		},
		{
			label: BLOCK_MENU_ACTIONS[4],
			icon: 'list-checks',
			children: block.variants.map((variant) => ({
				label: variant.label,
				checked: variant.normalizedLabel === normalizeLabel(authoredLabel),
				keepOpen: true,
				onSelect: () => host.setBlockDefaultLabel(
					path,
					block,
					variant.label,
					origin ?? undefined,
				),
			})),
		},
		{
			label: BLOCK_MENU_ACTIONS[5],
			icon: 'layout-template',
			children: [
				{ label: 'Toggle', value: 'toggle' as const },
				{ label: 'Columns', value: 'columns' as const },
			].map(({ label, value }) => ({
				label,
				checked: authoredView === value,
				keepOpen: true,
				onSelect: () => host.setBlockAuthoredView(
					path,
					block,
					value,
					origin ?? undefined,
				),
			})),
		},
		{
			label: BLOCK_MENU_ACTIONS[6],
			icon: 'columns-3',
			onSelect: () => host.openColumnRatios(path, block, origin ?? undefined),
		},
		{
			label: BLOCK_MENU_ACTIONS[7],
			icon: 'panel-top-dashed',
			children: NARROW_LAYOUT_OPTIONS.map(({ label, value }) => ({
				label,
				checked: responsive === value,
				keepOpen: true,
				onSelect: () => host.setBlockResponsive(
					path,
					block,
					value,
					origin ?? undefined,
				),
			})),
		},
		{ label: '-' },
		{
			label: BLOCK_MENU_ACTIONS[8],
			checked: followingGlobal,
			onSelect: () => {
				if (followingGlobal) {
					host.store.unfollowGlobalState(path, block);
					return;
				}
				host.store.followGlobalState(path, block);
			},
		},
		{
			label: BLOCK_MENU_ACTIONS[9],
			icon: 'rotate-ccw',
			badge:
				state.differsFromAuthored && host.store.settings.showIndicators
					? 'Modified'
					: undefined,
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
	const scope = host.store.isFollowingGlobalState(path, block)
		? 'Following global'
		: 'Local state';
	const current = `${block.attributes.name ? `${block.attributes.name} · ` : ''}${state.selectedLabel} · ${viewLabel(state.view)} · ${scope}`;
	if (!state.differsFromAuthored) return current;
	return `${current} · default ${effectiveAuthoredLabel(block)} / ${viewLabel(
		effectiveAuthoredView(block, host.store.settings.defaultView),
	)}`;
}

function viewLabel(view: string): string {
	return view.charAt(0).toUpperCase() + view.slice(1);
}
