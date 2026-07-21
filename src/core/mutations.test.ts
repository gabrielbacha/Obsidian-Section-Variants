import { describe, expect, it } from 'vitest';
import { FakeApp } from '../test/obsidian-mock';
import type { App } from 'obsidian';
import {
	addStableBlockId,
	addVariant,
	deleteVariant,
	fixMissingClosers,
	renameVariant,
	updateBlockAttributes,
} from './mutations';
import { parseNote } from './parser';
import { ParsedNote, VariantBlock } from './types';

const parse = (source: string): ParsedNote => parseNote(source, []);

class FakeEditor {
	transactionCount = 0;

	constructor(private content: string) {}

	getValue(): string {
		return this.content;
	}

	offsetToPos(offset: number): { line: number; ch: number } {
		const before = this.content.slice(0, offset);
		const lines = before.split('\n');
		return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 };
	}

	transaction(transaction: {
		changes?: Array<{
			from: { line: number; ch: number };
			to: { line: number; ch: number };
			text: string;
		}>;
	}): void {
		this.transactionCount += 1;
		for (const change of [...(transaction.changes ?? [])].reverse()) {
			const from = this.positionToOffset(change.from);
			const to = this.positionToOffset(change.to);
			this.content = `${this.content.slice(0, from)}${change.text}${this.content.slice(to)}`;
		}
	}

	private positionToOffset(position: { line: number; ch: number }): number {
		const lines = this.content.split('\n');
		return (
			lines.slice(0, position.line).reduce((length, line) => length + line.length + 1, 0) +
			position.ch
		);
	}
}

function setup(content: string): {
	app: App;
	path: string;
	read: () => string;
	firstBlock: () => VariantBlock;
} {
	const fake = new FakeApp();
	const path = 'Note.md';
	fake.vault.add(path, content);
	const read = (): string => fake.vault.read(path);
	return {
		app: fake as unknown as App,
		path,
		read,
		firstBlock: () => {
			const block = parse(read()).blocks[0];
			if (!block) throw new Error('Expected a parsed block.');
			return block;
		},
	};
}

const TWO_VARIANTS = [
	':::: variants',
	'',
	'::: A',
	'Alpha.',
	':::',
	'',
	'::: B',
	'Beta.',
	':::',
	'',
	'::::',
	'',
].join('\n');

describe('addStableBlockId', () => {
	it('appends a block ID after the closing fence', async () => {
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);

		const result = await addStableBlockId(app, path, firstBlock(), parse);

		expect(result.id).toMatch(/^variants-[a-z0-9]{6}$/u);
		expect(result.before.blockId).toBeUndefined();
		expect(result.after.blockId).toBe(result.id);
		expect(read()).toContain(`::::\n^${result.id}`);
	});

	it('leaves the authored content untouched', async () => {
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);

		await addStableBlockId(app, path, firstBlock(), parse);

		expect(read()).toContain('Alpha.');
		expect(read()).toContain('Beta.');
		expect(parse(read()).blocks[0]?.variants).toHaveLength(2);
	});

	it('adds a second, distinct ID without disturbing the first', async () => {
		/*
		 * A smoke test, not a proof of collision handling: with a 36^6 space a
		 * natural collision will not occur here. Exercising the retry path would
		 * need injectable randomness, which `randomId` does not currently expose.
		 */
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);
		const first = await addStableBlockId(app, path, firstBlock(), parse);

		const second = await addStableBlockId(app, path, firstBlock(), parse);

		expect(second.id).not.toBe(first.id);
		expect(read()).toContain(first.id);
		expect(read()).toContain(second.id);
	});

	it('refuses to add an ID when the block has no closing fence', async () => {
		const { app, path, firstBlock } = setup(
			[':::: variants', '', '::: A', 'Alpha.', ':::', ''].join('\n'),
		);

		await expect(
			addStableBlockId(app, path, firstBlock(), parse),
		).rejects.toThrow(/close the variants block/iu);
	});

	it('preserves CRLF line endings around an inserted ID', async () => {
		const source = TWO_VARIANTS.replace(/\n/gu, '\r\n');
		const { app, path, read, firstBlock } = setup(source);

		const result = await addStableBlockId(app, path, firstBlock(), parse);

		expect(read()).toContain(`::::\r\n^${result.id}\r\n`);
	});
});

describe('fixMissingClosers', () => {
	it('appends the missing container fence at end of file', async () => {
		const { app, path, read, firstBlock } = setup(
			[':::: variants', '', '::: A', 'Alpha.', ':::', '', '::: B', 'Beta.', ':::'].join(
				'\n',
			),
		);

		await fixMissingClosers(app, path, firstBlock(), parse);

		expect(read().trimEnd().endsWith('::::')).toBe(true);
		expect(parse(read()).blocks[0]?.valid).toBe(true);
	});

	it('closes an unterminated variant as well as the container', async () => {
		const { app, path, read, firstBlock } = setup(
			[':::: variants', '', '::: A', 'Alpha.', ':::', '', '::: B', 'Beta.'].join('\n'),
		);

		await fixMissingClosers(app, path, firstBlock(), parse);

		const fixed = parse(read()).blocks[0];
		expect(fixed?.valid).toBe(true);
		expect(fixed?.variants).toHaveLength(2);
	});

	it('refuses when the block is already closed', async () => {
		const { app, path, firstBlock } = setup(TWO_VARIANTS);

		await expect(
			fixMissingClosers(app, path, firstBlock(), parse),
		).rejects.toThrow(/unambiguous/iu);
	});
});

describe('renameVariant', () => {
	it('renames a shorthand label in place', async () => {
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);

		await renameVariant(app, path, firstBlock(), 'A', 'Alpha', false, parse);

		const labels = parse(read()).blocks[0]?.variants.map((v) => v.label);
		expect(labels).toEqual(['Alpha', 'B']);
	});

	it('switches to the explicit form when the new label needs it', async () => {
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);

		await renameVariant(app, path, firstBlock(), 'A', 'Long label', false, parse);

		expect(read()).toContain('label="Long label"');
		expect(parse(read()).blocks[0]?.variants[0]?.label).toBe('Long label');
	});

	it('leaves the other variant and its content alone', async () => {
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);

		await renameVariant(app, path, firstBlock(), 'A', 'Alpha', false, parse);

		expect(read()).toContain('Alpha.');
		expect(read()).toContain('Beta.');
		expect(parse(read()).blocks[0]?.variants[1]?.label).toBe('B');
	});

	it('returns old/new mappings without mutating the supplied parse result', async () => {
		const { app, path, firstBlock } = setup(TWO_VARIANTS);
		const original = firstBlock();

		const result = await renameVariant(app, path, original, 'A', 'Alpha', false, parse);

		expect(original.variants[0]?.label).toBe('A');
		expect(result.mappings[0]?.before).not.toBe(result.mappings[0]?.after);
		expect(result.mappings[0]?.after.variants[0]?.label).toBe('Alpha');
	});

	it('supports case-only renames', async () => {
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);

		const result = await renameVariant(app, path, firstBlock(), 'A', 'a', false, parse);

		expect(result.mappings).toHaveLength(1);
		expect(parse(read()).blocks[0]?.variants[0]?.label).toBe('a');
	});
});

describe('addVariant', () => {
	it('adds an empty, valid variant before the outer closing fence', async () => {
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);

		const result = await addVariant(app, path, firstBlock(), 'Long label', parse);

		expect(result.after.variants.map((variant) => variant.label)).toEqual([
			'A',
			'B',
			'Long label',
		]);
		expect(read()).toContain('::: {.variant label="Long label"}\n\n:::\n::::');
		expect(result.after.valid).toBe(true);
	});

	it('rejects duplicate labels ignoring case', async () => {
		const { app, path, firstBlock } = setup(TWO_VARIANTS);

		await expect(
			addVariant(app, path, firstBlock(), 'a', parse),
		).rejects.toThrow(/already exists/iu);
	});

	it('updates an open editor in one transaction instead of the vault copy', async () => {
		const { app, path, read, firstBlock } = setup(TWO_VARIANTS);
		const editor = new FakeEditor(read());

		const result = await addVariant(
			app,
			path,
			firstBlock(),
			'C',
			parse,
			editor as never,
		);

		expect(editor.transactionCount).toBe(1);
		expect(parse(editor.getValue()).blocks[0]?.variants).toHaveLength(3);
		expect(result.source).toBe(editor.getValue());
		expect(read()).toBe(TWO_VARIANTS);
	});

	it('preserves CRLF while updating an open editor', async () => {
		const source = TWO_VARIANTS.replace(/\n/gu, '\r\n');
		const { app, path, read, firstBlock } = setup(source);
		const editor = new FakeEditor(read());

		await addVariant(app, path, firstBlock(), 'C', parse, editor as never);

		expect(editor.getValue()).toContain('::: C\r\n\r\n:::\r\n::::');
		expect(editor.getValue().replace(/\r\n/gu, '')).not.toContain('\n');
	});
});

describe('updateBlockAttributes', () => {
	it('persists a box name through the open editor while preserving attributes', async () => {
		const source = TWO_VARIANTS.replace(
			':::: variants',
			':::: {.variants #copy view="columns" widths="40% 60%"}',
		);
		const { app, path, read, firstBlock } = setup(source);
		const editor = new FakeEditor(read());
		const block = firstBlock();

		const result = await updateBlockAttributes(
			app,
			path,
			block,
			{ ...block.attributes, name: 'Homepage copy' },
			parse,
			editor as never,
		);

		expect(editor.transactionCount).toBe(1);
		expect(result.after.attributes).toMatchObject({
			id: 'copy',
			name: 'Homepage copy',
			view: 'columns',
			widths: '40% 60%',
		});
		expect(read()).toBe(source);

		const cleared = await updateBlockAttributes(
			app,
			path,
			result.after,
			{ ...result.after.attributes, name: undefined },
			parse,
			editor as never,
		);
		expect(cleared.after.attributes.name).toBeUndefined();
		expect(cleared.after.attributes).toMatchObject({
			id: 'copy',
			view: 'columns',
			widths: '40% 60%',
		});
	});
});

describe('deleteVariant', () => {
	it('deletes the chosen variant and all of its content', async () => {
		const source = TWO_VARIANTS.replace(
			'::: B\nBeta.\n:::',
			'::: B\nBeta.\n:::\n\n::: C\nGamma.\n:::',
		);
		const { app, path, read, firstBlock } = setup(source);

		const result = await deleteVariant(app, path, firstBlock(), 'B', parse);

		expect(result.after.variants.map((variant) => variant.label)).toEqual(['A', 'C']);
		expect(read()).not.toContain('Beta.');
		expect(read()).toContain('Gamma.');
	});

	it('clears an authored default that points at the deleted variant', async () => {
		const source = TWO_VARIANTS.replace(
			':::: variants',
			':::: {.variants default="B"}',
		).replace('::: B\nBeta.\n:::', '::: B\nBeta.\n:::\n::: C\nGamma.\n:::');
		const { app, path, read, firstBlock } = setup(source);

		await deleteVariant(app, path, firstBlock(), 'B', parse);

		expect(parse(read()).blocks[0]?.attributes.defaultLabel).toBeUndefined();
	});

	it('allows one temporary variant but refuses to delete the last one', async () => {
		const { app, path, firstBlock } = setup(TWO_VARIANTS);

		const result = await deleteVariant(app, path, firstBlock(), 'A', parse);

		expect(result.after.valid).toBe(true);
		expect(result.after.variants.map((variant) => variant.label)).toEqual(['B']);

		await expect(
			deleteVariant(app, path, result.after, 'B', parse),
		).rejects.toThrow(/at least one/iu);
	});
});
