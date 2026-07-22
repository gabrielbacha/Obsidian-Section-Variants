import { ResponsiveMode } from '../core/types';

export const BLOCK_MENU_ACTIONS = [
	'Add variant',
	'Rename variant',
	'Delete variant',
	'Box name',
	'Authored default',
	'Authored view',
	'Edit column relative widths',
	'Narrow-screen layout',
	'Follow global state',
	'Reset to authored defaults',
	'Delete box',
] as const;

export const NARROW_LAYOUT_OPTIONS: ReadonlyArray<{
	label: string;
	value: ResponsiveMode;
}> = [
	{ label: 'Wrap into rows', value: 'responsive' },
	{ label: 'Stack vertically', value: 'stack' },
	{ label: 'Scroll horizontally', value: 'scroll' },
];
