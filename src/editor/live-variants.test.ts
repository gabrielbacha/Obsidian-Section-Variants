import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { liveEditableVariants } from './live-variants';

const block = parseNote(
	[
		':::: variants',
		'::: A',
		'A content',
		':::',
		'::: B',
		'B content',
		':::',
		'::::',
	].join('\n'),
).blocks[0];

if (!block) throw new Error('Missing variants fixture');

describe('Live Preview editable variants', () => {
	it('keeps only the selected Toggle variant editable', () => {
		expect(
			liveEditableVariants(block, 'toggle', 'B', new Set()).map(
				(variant) => variant.label,
			),
		).toEqual(['B']);
	});

	it('makes every visible column directly editable', () => {
		expect(
			liveEditableVariants(block, 'columns', 'A', new Set()).map(
				(variant) => variant.label,
			),
		).toEqual(['A', 'B']);
		expect(
			liveEditableVariants(block, 'columns', 'A', new Set(['a'])).map(
				(variant) => variant.label,
			),
		).toEqual(['B']);
	});
});
