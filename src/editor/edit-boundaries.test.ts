import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { VariantSection } from '../core/types';
import {
	changesAreWithinEditableSpans,
	DocumentChange,
	EditableSpan,
	editableSpansForVariant,
} from './edit-boundaries';

const SOURCE = [
	'Outside before.',
	':::: variants',
	'::: A',
	'Alpha',
	':::',
	'::: B',
	'Beta',
	':::',
	'::::',
	'Outside after.',
].join('\n');

describe('live preview edit boundaries', () => {
	it('allows typing and Enter at both content endpoints', () => {
		const { parsed, active, spans } = fixture();
		const contentEnd = spans.at(-1)?.to;
		if (contentEnd === undefined) throw new Error('Missing editable span');
		expect(allowed(parsed, spans, { from: active.content.from, to: active.content.from })).toBe(true);
		expect(allowed(parsed, spans, { from: contentEnd, to: contentEnd })).toBe(true);
	});

	it('blocks repeated Backspace at the opening boundary', () => {
		const { parsed, active, spans } = fixture();
		const backspace = {
			from: active.content.from - 1,
			to: active.content.from,
		};
		expect(allowed(parsed, spans, backspace)).toBe(false);
		expect(allowed(parsed, spans, backspace)).toBe(false);
	});

	it('blocks forward Delete and selections through the closing fence', () => {
		const { parsed, active, spans } = fixture();
		const contentEnd = spans.at(-1)?.to;
		if (contentEnd === undefined) throw new Error('Missing editable span');
		expect(
			allowed(parsed, spans, {
				from: contentEnd,
				to: contentEnd + 1,
			}),
		).toBe(false);
		expect(
			allowed(parsed, spans, {
				from: contentEnd - 1,
				to: active.content.to + 1,
			}),
		).toBe(false);
	});

	it('rejects edits in inactive variants and an entire invalid multi-range edit', () => {
		const { parsed, block, active, spans } = fixture();
		const inactive = block.variants[1];
		if (!inactive) throw new Error('Missing inactive variant');
		expect(
			allowed(parsed, spans, {
				from: inactive.content.from,
				to: inactive.content.from,
			}),
		).toBe(false);
		expect(
			changesAreWithinEditableSpans(parsed, spans, [
				{ from: active.content.from, to: active.content.from },
				{ from: inactive.content.from, to: inactive.content.from },
			]),
		).toBe(false);
	});

	it('allows ordinary edits outside valid blocks and inside invalid source', () => {
		const { parsed, spans } = fixture();
		expect(allowed(parsed, spans, { from: 0, to: 0 })).toBe(true);

		const invalid = parseNote([':::: variants', '::: A', 'text'].join('\n'));
		expect(
			changesAreWithinEditableSpans(invalid, [], [{ from: 20, to: 20 }]),
		).toBe(true);
	});

	it('protects a truly empty variant and permits a preserved blank content line', () => {
		const parsed = parseNote(
			[':::: variants', '::: A', ':::', '::: B', ':::', '::::'].join('\n'),
		);
		const active = parsed.blocks[0]?.variants[0];
		if (!active) throw new Error('Missing empty variant');
		const spans = editableSpansForVariant(active, parsed.source);
		expect(active.content.from).toBe(active.content.to);
		expect(allowed(parsed, spans, { from: active.content.from, to: active.content.from })).toBe(false);
		expect(
			allowed(parsed, spans, {
				from: active.content.from,
				to: active.content.from,
				inserted: '\n',
			}),
		).toBe(true);
		expect(
			allowed(parsed, spans, {
				from: active.content.from,
				to: active.content.from,
				inserted: 'Pasted text\n',
			}),
		).toBe(true);
		expect(allowed(parsed, spans, { from: active.content.from - 1, to: active.content.from })).toBe(false);
		expect(allowed(parsed, spans, { from: active.content.to, to: active.content.to + 1 })).toBe(false);

		const withBlank = parseNote(
			[':::: variants', '::: A', '', ':::', '::: B', '', ':::', '::::'].join('\n'),
		);
		const blank = withBlank.blocks[0]?.variants[0];
		if (!blank) throw new Error('Missing blank variant');
		const blankSpans = editableSpansForVariant(blank, withBlank.source);
		expect(allowed(withBlank, blankSpans, { from: blank.content.from, to: blank.content.from })).toBe(true);
		expect(allowed(withBlank, blankSpans, { from: blank.content.from, to: blank.content.from + 1 })).toBe(false);
	});

	it('cuts nested blocks out of the parent while allowing the nested active variant', () => {
		const parsed = parseNote(NESTED_SOURCE);
		const outer = parsed.roots[0];
		const outerVariant = outer?.variants[0];
		const child = outerVariant?.children[0];
		const innerVariant = child?.variants[0];
		if (!outerVariant || !child || !innerVariant) {
			throw new Error('Missing nested fixture');
		}
		const spans = [
			...editableSpansForVariant(outerVariant, parsed.source),
			...editableSpansForVariant(innerVariant, parsed.source),
		];
		expect(
			allowed(parsed, spans, {
				from: innerVariant.content.from,
				to: innerVariant.content.from,
			}),
		).toBe(true);
		expect(
			allowed(parsed, spans, {
				from: child.range.from - 1,
				to: child.range.from + 1,
			}),
		).toBe(false);
	});
});

function fixture(): {
	parsed: ReturnType<typeof parseNote>;
	block: ReturnType<typeof parseNote>['blocks'][number];
	active: VariantSection;
	spans: EditableSpan[];
} {
	const parsed = parseNote(SOURCE);
	const block = parsed.blocks[0];
	const active = block?.variants[0];
	if (!block || !active) throw new Error('Missing fixture block');
	return {
		parsed,
		block,
		active,
		spans: editableSpansForVariant(active, parsed.source),
	};
}

function allowed(
	parsed: ReturnType<typeof parseNote>,
	spans: readonly EditableSpan[],
	change: DocumentChange,
): boolean {
	return changesAreWithinEditableSpans(parsed, spans, [change]);
}

const NESTED_SOURCE = [
	'::::: variants',
	':::: A',
	'Before nested.',
	':::: variants',
	'::: X',
	'Inner X.',
	':::',
	'::: Y',
	'Inner Y.',
	':::',
	'::::',
	'After nested.',
	'::::',
	':::: B',
	'Outer B.',
	'::::',
	':::::',
].join('\n');
