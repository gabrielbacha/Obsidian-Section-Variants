import { describe, expect, it } from 'vitest';
import { BLOCK_MENU_ACTIONS } from './block-menu-actions';

describe('block marker menu contract', () => {
	it('contains only the four focused block actions', () => {
		expect(BLOCK_MENU_ACTIONS).toEqual([
			'Follow global state',
			'Reset to authored defaults',
			'Configure defaults',
			'Rename variant',
		]);
	});
});
