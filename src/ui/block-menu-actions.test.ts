import { describe, expect, it } from 'vitest';
import { BLOCK_MENU_ACTIONS } from './block-menu-actions';

describe('block marker menu contract', () => {
	it('contains focused box and structural variant actions', () => {
		expect(BLOCK_MENU_ACTIONS).toEqual([
			'Add variant',
			'Rename variant',
			'Delete variant',
			'Configure box',
			'Follow global state',
			'Reset to authored defaults',
		]);
	});
});
