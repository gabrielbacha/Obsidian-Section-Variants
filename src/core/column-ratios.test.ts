import { describe, expect, it } from 'vitest';
import {
	parseColumnRatios,
	serializeColumnRatios,
	visibleColumnWidths,
} from './column-ratios';

describe('column ratios', () => {
	it('reads fractional and percentage tracks as ratios', () => {
		expect(parseColumnRatios('1fr 2fr 1fr', 3)).toEqual([1, 2, 1]);
		expect(parseColumnRatios('40% 60%', 2)).toEqual([40, 60]);
	});

	it('falls back when legacy tracks cannot be represented as ratios', () => {
		expect(parseColumnRatios('320px 1fr', 2)).toBeUndefined();
		expect(parseColumnRatios('1fr 2fr', 3)).toBeUndefined();
	});

	it('omits equal ratios and serializes unequal ratios as fractions', () => {
		expect(serializeColumnRatios([1, 1])).toBeUndefined();
		expect(serializeColumnRatios([2, 1.5])).toBe('2fr 1.5fr');
	});

	it('keeps ratios attached to the remaining visible variants', () => {
		expect(visibleColumnWidths('1fr 2fr 3fr', 3, [0, 2])).toBe('1fr 3fr');
		expect(visibleColumnWidths('1fr 2fr', 2, [1])).toBeUndefined();
		expect(visibleColumnWidths('320px 1fr', 2, [1])).toBe('320px 1fr');
	});
});
