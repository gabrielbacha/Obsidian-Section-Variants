import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { findReboundBlock } from './rebind';

const SOURCE = [
	':::: variants',
	'::: A',
	'One',
	':::',
	'::: B',
	'Two',
	':::',
	'::::',
].join('\n');

describe('Reading View structural rebinding', () => {
	it('rebinds by note order when adding a variant changes the fingerprint', () => {
		const before = parseNote(SOURCE).blocks;
		const after = parseNote(
			SOURCE.replace('\n::::', '\n::: C\nThree\n:::\n::::'),
		).blocks;

		expect(findReboundBlock(before, before[0]!, after)?.variants).toHaveLength(3);
	});

	it('keeps exact identities when only the box name changes', () => {
		const before = parseNote(SOURCE).blocks;
		const after = parseNote(
			SOURCE.replace(':::: variants', ':::: {.variants name="Options"}'),
		).blocks;

		expect(findReboundBlock(before, before[0]!, after)?.attributes.name).toBe(
			'Options',
		);
	});
});
