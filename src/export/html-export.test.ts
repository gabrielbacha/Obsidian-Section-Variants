import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { DEFAULT_SETTINGS, resolveBlockState } from '../core/state-model';
import { selectExportVariants } from './selection';

const SOURCE = [
	':::: {.variants default="A" view="toggle"}',
	'::: A',
	'One',
	':::',
	'::: B',
	'Two',
	':::',
	'::::',
].join('\n');

describe('HTML export state selection', () => {
	it('uses authored label and view regardless of current UI state', () => {
		const block = parseNote(SOURCE).blocks[0]!;
		const current = {
			...resolveBlockState(block, undefined, DEFAULT_SETTINGS),
			selectedLabel: 'B',
			view: 'columns' as const,
			hiddenLabels: new Set(['a']),
		};
		const selected = selectExportVariants(block, current, 'authored', 'toggle');
		expect(selected.view).toBe('toggle');
		expect(selected.variants.map((variant) => variant.label)).toEqual(['A']);
	});

	it('uses current selection and hidden columns in current-state exports', () => {
		const block = parseNote(SOURCE).blocks[0]!;
		const current = {
			...resolveBlockState(block, undefined, DEFAULT_SETTINGS),
			selectedLabel: 'B',
			view: 'columns' as const,
			hiddenLabels: new Set(['a']),
		};
		const selected = selectExportVariants(block, current, 'current', 'toggle');
		expect(selected.view).toBe('columns');
		expect(selected.variants.map((variant) => variant.label)).toEqual(['B']);
	});
});
