import { describe, expect, it } from 'vitest';
import { parseNote } from './parser';
import {
	applyGlobalLabel,
	applyGlobalView,
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

	it('keeps an authored reset independent of later global changes', () => {
		const parsed = parseNote(SOURCE);
		const block = parsed.blocks[0]!;
		const note = createNoteState();
		note.globalLabel = 'B';
		note.globalView = 'columns';
		const state = ensureBlockState(note, block.identityKey);
		state.labelMode = 'authored';
		state.viewMode = 'authored';

		expect(resolveBlockState(block, note, DEFAULT_SETTINGS)).toMatchObject({
			selectedLabel: 'A',
			view: 'toggle',
		});
		note.globalLabel = 'A';
		note.globalView = 'auto';
		expect(resolveBlockState(block, note, DEFAULT_SETTINGS)).toMatchObject({
			selectedLabel: 'A',
			view: 'toggle',
		});
	});

	it('global actions clear the corresponding authored marker', () => {
		const parsed = parseNote(SOURCE);
		const note = createNoteState();
		for (const block of parsed.blocks) {
			const state = ensureBlockState(note, block.identityKey);
			state.labelMode = 'authored';
			state.viewMode = 'authored';
		}

		applyGlobalLabel(note, parsed, DEFAULT_SETTINGS, 'B');
		applyGlobalView(note, parsed, 'columns');

		expect(note.blocks[parsed.blocks[0]!.identityKey]?.labelMode).toBeUndefined();
		expect(note.blocks[parsed.blocks[0]!.identityKey]?.viewMode).toBeUndefined();
	});

	it('excludes invalid blocks from global result counts and mutations', () => {
		const parsed = parseNote(`${SOURCE}\n\n:::: variants\n::: A\nOnly one\n:::\n::::`);
		const invalid = parsed.blocks.at(-1)!;
		const note = createNoteState();
		ensureBlockState(note, invalid.identityKey).labelMode = 'authored';

		const result = applyGlobalLabel(note, parsed, DEFAULT_SETTINGS, 'A');

		expect(result.applied + result.skipped).toBe(2);
		expect(note.blocks[invalid.identityKey]?.labelMode).toBe('authored');
	});
});
