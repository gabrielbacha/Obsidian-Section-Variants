import { describe, expect, it } from 'vitest';
import { parseNote } from './parser';
import {
	defaultHtmlExportPath,
	serializeContainerOpening,
	serializeVariantsBlock,
} from './serializer';

describe('serializeContainerOpening', () => {
	it('serializes a canonical container opening', () => {
		expect(
			serializeContainerOpening(4, {
				id: 'topic',
				name: 'Audience copy',
				view: 'columns',
				defaultLabel: 'Long label',
				widths: '40% 60%',
				minWidth: '320px',
				responsive: 'scroll',
			}),
		).toBe(
			':::: {.variants #topic name="Audience copy" view="columns" default="Long label" widths="40% 60%" min-width="320px" responsive="scroll"}',
		);
	});
});

describe('defaultHtmlExportPath', () => {
	it('derives the export path next to a note', () => {
		expect(defaultHtmlExportPath('Folder/Note.md')).toBe(
			'Folder/Note variants.html',
		);
	});
});

describe('serializeVariantsBlock', () => {
	it('generates Pandoc-valid shorthand and explicit labels', () => {
		const serialized = serializeVariantsBlock({
			labels: ['A', 'Long label'],
			name: 'Campaign copy',
			defaultLabel: 'Long label',
			view: 'columns',
			responsive: 'scroll',
		});

		expect(serialized.markdown).toContain(':::: {.variants name="Campaign copy" view="columns" default="Long label" responsive="scroll"}');
		expect(serialized.markdown).toContain('::: A');
		expect(serialized.markdown).toContain('::: {.variant label="Long label"}');
		expect(parseNote(serialized.markdown).roots[0]?.valid).toBe(true);
		expect(parseNote(serialized.markdown).roots[0]?.attributes.name).toBe(
			'Campaign copy',
		);
	});

	it('escapes explicit label values', () => {
		const serialized = serializeVariantsBlock({ labels: ['A', 'A "quote"'] });

		expect(serialized.markdown).toContain('label="A \\"quote\\""');
		expect(parseNote(serialized.markdown).roots[0]?.variants[1]?.label).toBe('A "quote"');
	});

	it('rejects duplicate labels ignoring case', () => {
		expect(() =>
			serializeVariantsBlock({ labels: ['One', 'one'] }),
		).toThrow(/unique/u);
	});
});
