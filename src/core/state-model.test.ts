import { describe, expect, it } from 'vitest';
import { parseNote } from './parser';
import {
	applyGlobalLabel,
	createNoteState,
	DEFAULT_SETTINGS,
	ensureBlockState,
	resolveBlockState,
} from './state-model';

const SOURCE = [
	':::: {.variants default="A"}',
	'::: A',
	'One',
	':::',
	'::: B',
	'Two',
	':::',
	'::::',
	'',
	':::: variants',
	'::: A',
	'Three',
	':::',
	'::: C',
	'Four',
	':::',
	'::::',
].join('\n');

describe('state model', () => {
	it('resolves block override before global and authored defaults', () => {
		const parsed = parseNote(SOURCE);
		const block = parsed.blocks[0];
		const note = createNoteState();
		note.globalLabel = 'B';
		if (!block) throw new Error('Missing fixture block');

		expect(resolveBlockState(block, note, DEFAULT_SETTINGS).selectedLabel).toBe('B');
		ensureBlockState(note, block.identityKey).selectedLabel = 'A';
		expect(resolveBlockState(block, note, DEFAULT_SETTINGS).selectedLabel).toBe('A');
	});

	it('applies a global label and preserves unmatched followers', () => {
		const parsed = parseNote(SOURCE);
		const note = createNoteState();
		note.globalLabel = 'A';

		const result = applyGlobalLabel(note, parsed, DEFAULT_SETTINGS, 'B');

		expect(result).toEqual({ applied: 1, skipped: 1 });
		expect(resolveBlockState(parsed.blocks[0]!, note, DEFAULT_SETTINGS).selectedLabel).toBe('B');
		expect(resolveBlockState(parsed.blocks[1]!, note, DEFAULT_SETTINGS).selectedLabel).toBe('A');
	});

	it('uses session-only visibility when it exists', () => {
		const parsed = parseNote(SOURCE);
		const block = parsed.blocks[0];
		const note = createNoteState();
		if (!block) throw new Error('Missing fixture block');
		ensureBlockState(note, block.identityKey).savedHiddenLabels = ['B'];

		const resolved = resolveBlockState(
			block,
			note,
			DEFAULT_SETTINGS,
			new Set(['A']),
		);
		expect([...resolved.hiddenLabels]).toEqual(['a']);
	});

	it('lets session visibility override saved hidden columns', () => {
		const parsed = parseNote(SOURCE);
		const block = parsed.blocks[0];
		const note = createNoteState();
		if (!block) throw new Error('Missing fixture block');
		ensureBlockState(note, block.identityKey).savedHiddenLabels = ['B'];

		expect(
			resolveBlockState(block, note, DEFAULT_SETTINGS).hiddenLabels.has('b'),
		).toBe(true);
		expect(
			resolveBlockState(block, note, DEFAULT_SETTINGS, new Set()).hiddenLabels.size,
		).toBe(0);
	});
});
