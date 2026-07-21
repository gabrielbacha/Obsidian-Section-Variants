import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { mapSectionFenceTexts } from './section-mapping';

const SOURCE = [
	'Before ::: text',
	':::: variants',
	'::: A',
	'One',
	':::',
	'::: B',
	'Two',
	':::',
	'::::',
	'After',
].join('\n');

describe('Reading View section mapping', () => {
	it('matches exact fence text in exact order within a section', () => {
		const fences = parseNote(SOURCE).fences;
		const mapped = mapSectionFenceTexts(
			fences,
			{ lineStart: 1, lineEnd: 4 },
			[':::: variants', '::: A', ':::'],
		);
		expect(mapped?.map((fence) => fence.lineStart)).toEqual([1, 2, 4]);
	});

	it('maps separate chunks of a spanning block independently', () => {
		const fences = parseNote(SOURCE).fences;
		expect(
			mapSectionFenceTexts(fences, { lineStart: 1, lineEnd: 4 }, [
				':::: variants',
				'::: A',
				':::',
			]),
		).toHaveLength(3);
		expect(
			mapSectionFenceTexts(fences, { lineStart: 5, lineEnd: 8 }, [
				'::: B',
				':::',
				'::::',
			]),
		).toHaveLength(3);
	});

	it('rejects partial, reordered, and ambiguous mappings', () => {
		const fences = parseNote(SOURCE).fences;
		expect(
			mapSectionFenceTexts(fences, { lineStart: 1, lineEnd: 4 }, [':::: variants']),
		).toBeUndefined();
		expect(
			mapSectionFenceTexts(fences, { lineStart: 1, lineEnd: 4 }, [
				'::: A',
				':::: variants',
				':::',
			]),
		).toBeUndefined();
	});

	it('ignores repeated colon text outside the section line range', () => {
		const fences = parseNote(SOURCE).fences;
		const mapped = mapSectionFenceTexts(fences, { lineStart: 7, lineEnd: 8 }, [
			':::',
			'::::',
		]);
		expect(mapped?.map((fence) => fence.lineStart)).toEqual([7, 8]);
	});
});
