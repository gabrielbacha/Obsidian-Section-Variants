import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { editableSpansForVariant } from './edit-boundaries';

describe('inline editor prose islands', () => {
	it('keeps the closing-fence line break outside a nonempty editor', () => {
		const parsed = parseNote(
			[':::: variants', '::: A', 'Alpha', ':::', '::::'].join('\n'),
		);
		const variant = parsed.blocks[0]?.variants[0];
		if (!variant) throw new Error('Missing variant fixture');

		const spans = editableSpansForVariant(variant, parsed.source);

		expect(spans).toHaveLength(1);
		expect(parsed.source.slice(spans[0]?.from, spans[0]?.to)).toBe('Alpha');
	});

	it('marks a truly empty variant for safe first-edit serialization', () => {
		const parsed = parseNote(
			[':::: variants', '::: A', ':::', '::::'].join('\n'),
		);
		const variant = parsed.blocks[0]?.variants[0];
		if (!variant) throw new Error('Missing empty variant fixture');

		expect(editableSpansForVariant(variant, parsed.source)).toEqual([
			{
				from: variant.content.from,
				to: variant.content.to,
				requiresTrailingLineBreak: true,
			},
		]);
	});

	it('cuts a nested variants block out of its parent prose editors', () => {
		const parsed = parseNote(NESTED_SOURCE);
		const parent = parsed.roots[0]?.variants[0];
		if (!parent) throw new Error('Missing nested parent fixture');

		const prose = editableSpansForVariant(parent, parsed.source).map((span) =>
			parsed.source.slice(span.from, span.to),
		);

		expect(prose).toEqual(['Before nested.', 'After nested.']);
	});
});

const NESTED_SOURCE = [
	'::::: variants',
	':::: A',
	'Before nested.',
	':::: variants',
	'::: X',
	'Inner X.',
	':::',
	'::: Y',
	'Inner Y.',
	':::',
	'::::',
	'After nested.',
	'::::',
	':::: B',
	'Outer B.',
	'::::',
	':::::',
].join('\n');
