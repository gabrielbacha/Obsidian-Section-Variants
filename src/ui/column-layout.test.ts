import { describe, expect, it } from 'vitest';
import { activeColumnWidths, classifyColumnRows } from './column-layout';

describe('column separator rows', () => {
	it('keeps side-by-side columns in the first row', () => {
		expect(classifyColumnRows([12, 12])).toEqual([
			{ laterRow: false, rowStart: false, rowEnd: false },
			{ laterRow: false, rowStart: false, rowEnd: true },
		]);
	});

	it('marks each vertically stacked column as a new row', () => {
		expect(classifyColumnRows([12, 220, 410])).toEqual([
			{ laterRow: false, rowStart: false, rowEnd: true },
			{ laterRow: true, rowStart: true, rowEnd: true },
			{ laterRow: true, rowStart: true, rowEnd: true },
		]);
	});

	it('distinguishes new rows in a wrapping two-column grid', () => {
		expect(classifyColumnRows([12, 12, 220, 220])).toEqual([
			{ laterRow: false, rowStart: false, rowEnd: false },
			{ laterRow: false, rowStart: false, rowEnd: true },
			{ laterRow: true, rowStart: true, rowEnd: false },
			{ laterRow: true, rowStart: false, rowEnd: true },
		]);
	});
});

describe('responsive column ratios', () => {
	it('uses ratios only while every visible column fits side by side', () => {
		expect(activeColumnWidths('2fr 1fr', 'responsive', 800, 2)).toBe('2fr 1fr');
		expect(activeColumnWidths('2fr 1fr', 'responsive', 600, 2)).toBeUndefined();
	});

	it('lets forced stack and horizontal scroll own the narrow layout', () => {
		expect(activeColumnWidths('2fr 1fr', 'stack', 1200, 2)).toBeUndefined();
		expect(activeColumnWidths('2fr 1fr', 'scroll', 1200, 2)).toBeUndefined();
	});
});
