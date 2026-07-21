import { describe, expect, it } from 'vitest';
import { VIEW_MODE_SEGMENTS } from './segmented-control';

describe('selectable view modes', () => {
	it('offers Toggle and Columns without retired Auto', () => {
		expect(VIEW_MODE_SEGMENTS.map((option) => option.value)).toEqual([
			'toggle',
			'columns',
		]);
	});
});
