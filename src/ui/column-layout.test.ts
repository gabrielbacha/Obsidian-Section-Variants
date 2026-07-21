import { describe, expect, it } from 'vitest';
import { classifyColumnRows } from './column-layout';

describe('column separator rows', () => {
	it('keeps side-by-side columns in the first row', () => {
		expect(classifyColumnRows([12, 12])).toEqual([
			{ laterRow: false, rowStart: false },
			{ laterRow: false, rowStart: false },
		]);
	});

	it('marks each vertically stacked column as a new row', () => {
		expect(classifyColumnRows([12, 220, 410])).toEqual([
			{ laterRow: false, rowStart: false },
			{ laterRow: true, rowStart: true },
			{ laterRow: true, rowStart: true },
		]);
	});

	it('distinguishes new rows in a wrapping two-column grid', () => {
		expect(classifyColumnRows([12, 12, 220, 220])).toEqual([
			{ laterRow: false, rowStart: false },
			{ laterRow: false, rowStart: false },
			{ laterRow: true, rowStart: true },
			{ laterRow: true, rowStart: false },
		]);
	});
});
