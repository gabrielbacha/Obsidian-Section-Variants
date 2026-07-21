import { describe, expect, it } from 'vitest';
import {
	mapInlineChanges,
	mapInlineSelection,
	selectionWithinInlineSpan,
} from './inline-changes';

describe('inline column change mapping', () => {
	it('maps ordinary and multi-range changes to outer offsets', () => {
		expect(
			mapInlineChanges(
				{ from: 20, to: 30 },
				[
					{ from: 1, to: 2, inserted: 'A' },
					{ from: 6, to: 8, inserted: 'BC' },
				],
			),
		).toEqual([
			{ from: 21, to: 22, inserted: 'A' },
			{ from: 26, to: 28, inserted: 'BC' },
		]);
	});

	it('adds the protected trailing newline for the first empty insertion', () => {
		expect(
			mapInlineChanges(
				{ from: 12, to: 12, requiresTrailingLineBreak: true },
				[{ from: 0, to: 0, inserted: 'First line' }],
			),
		).toEqual([{ from: 12, to: 12, inserted: 'First line\n' }]);
	});

	it('rejects a non-insertion against a truly empty island', () => {
		expect(
			mapInlineChanges(
				{ from: 12, to: 12, requiresTrailingLineBreak: true },
				[{ from: 0, to: 1, inserted: '' }],
			),
		).toBeUndefined();
	});

	it('round-trips selections between a child editor and the owning note', () => {
		const span = { from: 20, to: 30 };
		const relative = [
			{ anchor: 2, head: 6 },
			{ anchor: 8, head: 8 },
		];
		const absolute = mapInlineSelection(span, relative);
		expect(absolute).toEqual([
			{ anchor: 22, head: 26 },
			{ anchor: 28, head: 28 },
		]);
		expect(selectionWithinInlineSpan(span, absolute)).toEqual(relative);
	});

	it('does not import an outer selection from another island', () => {
		expect(
			selectionWithinInlineSpan(
				{ from: 20, to: 30 },
				[{ anchor: 19, head: 24 }],
			),
		).toBeUndefined();
	});
});
