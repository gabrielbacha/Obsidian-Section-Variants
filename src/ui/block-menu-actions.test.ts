import { describe, expect, it } from 'vitest';
import {
	BLOCK_MENU_ACTIONS,
	NARROW_LAYOUT_OPTIONS,
} from './block-menu-actions';

describe('block marker menu contract', () => {
	it('contains focused box and structural variant actions', () => {
		expect(BLOCK_MENU_ACTIONS).toEqual([
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
		]);
	});

	it('offers the three authored narrow-screen layouts directly', () => {
		expect(NARROW_LAYOUT_OPTIONS).toEqual([
			{ label: 'Wrap into rows', value: 'responsive' },
			{ label: 'Stack vertically', value: 'stack' },
			{ label: 'Scroll horizontally', value: 'scroll' },
		]);
	});
});
