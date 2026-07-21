import { describe, expect, it } from 'vitest';
import { parseNote } from './parser';
import { resolveCurrentBlock } from './block-resolution';

const block = (variants: readonly string[]): string => [
	':::: {.variants name="Box"}',
	...variants.flatMap((label) => [`::: ${label}`, label, ':::']),
	'::::',
].join('\n');

describe('current block resolution', () => {
	it('rebinds a stale block after a variant is added', () => {
		const before = parseNote(block(['A', 'B'])).blocks[0]!;
		const after = parseNote(block(['A', 'B', 'C'])).blocks;

		expect(resolveCurrentBlock(before, after)?.variants).toHaveLength(3);
	});

	it('rebinds the same open menu after the opening attributes change', () => {
		const before = parseNote(block(['A', 'B'])).blocks[0]!;
		const after = parseNote(
			block(['A', 'B']).replace('name="Box"', 'name="Renamed" view="columns"'),
		).blocks;

		expect(resolveCurrentBlock(before, after)?.attributes).toMatchObject({
			name: 'Renamed',
			view: 'columns',
		});
	});

	it('uses a unique structural match after edits above the block', () => {
		const before = parseNote(block(['A', 'B'])).blocks[0]!;
		const after = parseNote(`Intro\n\n${block(['A', 'B', 'C'])}`).blocks;

		expect(resolveCurrentBlock(before, after)?.opening.lineStart).toBe(2);
	});

	it('does not guess between structurally identical boxes', () => {
		const before = parseNote(block(['A', 'B'])).blocks[0]!;
		const source = `Intro\n${block(['A', 'B', 'C'])}\n\n${block(['A', 'B', 'D'])}`;

		expect(resolveCurrentBlock(before, parseNote(source).blocks)).toBeUndefined();
	});
});
