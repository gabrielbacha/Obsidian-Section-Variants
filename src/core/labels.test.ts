import { describe, expect, it } from 'vitest';
import { parseNote } from './parser';
import { collectLabelCatalog, filterLabelCatalog } from './labels';

describe('current-note label catalog', () => {
	it('ranks valid labels by frequency and then first appearance', () => {
		const parsed = parseNote([
			':::: variants', '::: {.variant label="Long label"}', 'One', ':::', '::: B', 'Two', ':::', '::::',
			':::: variants', '::: B', 'Three', ':::', '::: C', 'Four', ':::', '::::',
		].join('\n'));

		expect(collectLabelCatalog(parsed.blocks).map((entry) => entry.label)).toEqual([
			'B',
			'Long label',
			'C',
		]);
	});

	it('matches case-insensitively and excludes labels already in the dialog', () => {
		const entries = [
			{ label: 'Audience', count: 2, firstIndex: 0 },
			{ label: 'Long version', count: 1, firstIndex: 1 },
		];

		expect(
			filterLabelCatalog(entries, 'VER', new Set(['audience'])).map(
				(entry) => entry.label,
			),
		).toEqual(['Long version']);
	});
});
