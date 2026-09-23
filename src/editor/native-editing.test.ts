import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { editingPathVariant } from './native-editing';

describe('native Live Preview editing path', () => {
	it('selects the requested variant in its exact columns block', () => {
		const parsed = parseNote(BLOCK);
		const block = parsed.blocks[0];
		if (!block) throw new Error('Missing block fixture');

		expect(
			editingPathVariant(block, {
				blockFrom: block.opening.from,
				label: 'B',
			})?.label,
		).toBe('B');
	});

	it('exposes the ancestor variant that contains a nested editing target', () => {
		const parsed = parseNote(NESTED);
		const parent = parsed.roots[0];
		const child = parent?.variants[0]?.children[0];
		if (!parent || !child) throw new Error('Missing nested fixture');

		expect(
			editingPathVariant(parent, {
				blockFrom: child.opening.from,
				label: 'Y',
			})?.label,
		).toBe('A');
		expect(
			editingPathVariant(child, {
				blockFrom: child.opening.from,
				label: 'Y',
			})?.label,
		).toBe('Y');
	});
});

const BLOCK = [
	':::: {.variants view="columns"}',
	'::: A',
	'One',
	':::',
	'::: B',
	'Two',
	':::',
	'::::',
].join('\n');

const NESTED = [
	'::::: {.variants view="columns"}',
	':::: A',
	'Before',
	':::: {.variants view="columns"}',
	'::: X',
	'Inner X',
	':::',
	'::: Y',
	'Inner Y',
	':::',
	'::::',
	'After',
	'::::',
	':::: B',
	'Other',
	'::::',
	':::::',
].join('\n');
