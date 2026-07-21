import { describe, expect, it } from 'vitest';
import { BLOCK_MENU_ACTIONS } from './block-menu-actions';

describe('block marker menu contract', () => {
	it('contains focused box and structural variant actions', () => {
		expect(BLOCK_MENU_ACTIONS).toEqual([
			'Follow global state',
			'Reset to authored defaults',
			'Configure box',
			'Add variant',
			'Delete variant',
			'Rename variant',
		]);
	});
});
