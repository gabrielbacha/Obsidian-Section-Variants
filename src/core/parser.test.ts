import { describe, expect, it } from 'vitest';
import { parseNote } from './parser';

describe('parseNote', () => {
	it('parses shorthand and explicit variants', () => {
		const source = [
			':::: {.variants #topic view="columns" default="Long label"}',
			'',
			'::: A',
			'First',
			':::',
			'',
			'::: {.variant label="Long label"}',
			'Second',
			':::',
			'',
			'::::',
		].join('\n');
		const parsed = parseNote(source);
		const block = parsed.roots[0];

		expect(block?.valid).toBe(true);
		expect(block?.attributes).toMatchObject({
			id: 'topic',
			view: 'columns',
			defaultLabel: 'Long label',
		});
		expect(block?.variants.map((variant) => variant.label)).toEqual([
			'A',
			'Long label',
		]);
		expect(source.slice(block?.variants[0]?.content.from, block?.variants[0]?.content.to)).toContain('First');
	});

	it('supports nested blocks', () => {
		const source = [
			'::::: variants',
			':::: Parent',
			':::: variants',
			'::: ChildA',
			'One',
			':::',
			'::: ChildB',
			'Two',
			':::',
			'::::',
			'::::',
			':::: Parent2',
			'Other',
			'::::',
			':::::',
		].join('\n');
		const parsed = parseNote(source);

		expect(parsed.blocks).toHaveLength(2);
		expect(parsed.roots).toHaveLength(1);
		expect(parsed.roots[0]?.children).toHaveLength(1);
		expect(parsed.blocks.every((block) => block.valid)).toBe(true);
	});

	it('ignores div-looking lines inside code fences', () => {
		const source = [
			':::: variants',
			'::: A',
			'```markdown',
			'::: not-a-variant',
			':::',
			'```',
			':::',
			'::: B',
			'Two',
			':::',
			'::::',
		].join('\n');
		const parsed = parseNote(source);

		expect(parsed.roots[0]?.variants).toHaveLength(2);
		expect(parsed.roots[0]?.valid).toBe(true);
	});

	it('fails visibly for ambiguous shorthand and duplicate casing', () => {
		const source = [
			':::: variants',
			'::: Long label',
			'One',
			':::',
			'::: long LABEL',
			'Two',
			':::',
			'::::',
		].join('\n');
		const block = parseNote(source).roots[0];

		expect(block?.valid).toBe(false);
		expect(block?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
			expect.arrayContaining([
				'unsafe-variant-shorthand',
				'duplicate-variant-label',
			]),
		);
	});

	it('uses explicit IDs, block IDs, then ambiguous fingerprints', () => {
		const source = [
			':::: {.variants #first}',
			'::: A',
			'1',
			':::',
			'::: B',
			'2',
			':::',
			'::::',
			'',
			':::: variants',
			'::: A',
			'3',
			':::',
			'::: B',
			'4',
			':::',
			'::::',
			'^variants-second',
			'',
			':::: variants',
			'::: A',
			'5',
			':::',
			'::: B',
			'6',
			':::',
			'::::',
			'',
			':::: variants',
			'::: A',
			'7',
			':::',
			'::: B',
			'8',
			':::',
			'::::',
		].join('\n');
		const parsed = parseNote(source);

		expect(parsed.blocks[0]?.identityKey).toBe('id:first');
		expect(parsed.blocks[1]?.identityKey).toBe('block:variants-second');
		expect(parsed.blocks[2]?.identityAmbiguous).toBe(true);
		expect(parsed.blocks[3]?.identityAmbiguous).toBe(true);
	});

	it('reports an unclosed block without hiding its range', () => {
		const source = [':::: variants', '::: A', 'Content'].join('\n');
		const block = parseNote(source).roots[0];

		expect(block?.valid).toBe(false);
		expect(block?.range.to).toBe(source.length);
		expect(block?.diagnostics.some((item) => item.code === 'missing-closing-fence')).toBe(true);
	});
});
