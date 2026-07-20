import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
	blockSpan,
	fenceLineRange,
	selectionConfinedTo,
	selectionTouchesSpan,
} from './ranges';

/** Builds a document the way CodeMirror does, preserving the given newlines. */
const doc = (text: string): Text => Text.of(text.split('\n'));

describe('fenceLineRange', () => {
	it('swallows the trailing newline so no phantom line remains', () => {
		//            0123 4567890
		const text = ':::\ncontent';
		const range = fenceLineRange(doc(text), 0);

		// [0, 4) covers ':::' AND the '\n', so the fence line stops existing.
		expect(range).toEqual({ from: 0, to: 4 });
		expect(text.slice(range.from, range.to)).toBe(':::\n');
	});

	it('produces ranges that abut exactly and never overlap', () => {
		// Two fences on consecutive lines — the overlap case that would make
		// CodeMirror reject the decoration set.
		const source = doc(':::\n::::\ntail');
		const first = fenceLineRange(source, 0);
		const second = fenceLineRange(source, 4);

		expect(first.to).toBe(second.from);
		expect(first.to).toBeLessThanOrEqual(second.from);
	});

	it('does not run past the end when the fence is the final line', () => {
		const text = 'content\n::::';
		const source = doc(text);
		const range = fenceLineRange(source, 8);

		expect(range.to).toBe(source.length);
		expect(text.slice(range.from, range.to)).toBe('::::');
	});

	it('handles a document consisting only of a fence', () => {
		const source = doc(':::');
		expect(fenceLineRange(source, 0)).toEqual({ from: 0, to: 3 });
	});

	it('is correct for a fence anywhere on the line, not just its start', () => {
		const source = doc('::::\ncontent');
		// Parser offsets point at the line start, but a mid-line offset must
		// still resolve to the whole line.
		expect(fenceLineRange(source, 2)).toEqual(fenceLineRange(source, 0));
	});
});

describe('fenceLineRange with CRLF', () => {
	/*
	 * The parser strips \r before computing offsets, so its token `to` is short
	 * by one on CRLF documents. Deriving bounds from doc.lineAt sidesteps that
	 * entirely — this is the regression test for that latent bug.
	 */
	it('covers the full CRLF line break', () => {
		const text = ':::\r\ncontent';
		const source = Text.of(text.split('\n'));
		const range = fenceLineRange(source, 0);

		// The line is ':::\r' (4 chars); the range must also take the '\n'.
		expect(text.slice(range.from, range.to)).toBe(':::\r\n');
	});

	it('still abuts correctly across CRLF lines', () => {
		const source = Text.of(':::\r\n::::\r\ntail'.split('\n'));
		const first = fenceLineRange(source, 0);
		const second = fenceLineRange(source, first.to);

		expect(first.to).toBe(second.from);
	});
});

describe('blockSpan', () => {
	it('expands to whole-line bounds from interior offsets', () => {
		const source = doc(':::: variants\n::: A\nbody\n:::\n::::');
		// Offsets pointing mid-line at each end.
		const span = blockSpan(source, 3, 32);

		expect(span.from).toBe(0);
		expect(span.to).toBe(source.length);
	});

	it('is idempotent when already line-aligned', () => {
		const source = doc('one\ntwo\nthree');
		const once = blockSpan(source, 4, 7);
		const twice = blockSpan(source, once.from, once.to);

		expect(twice).toEqual(once);
	});
});

describe('selectionTouchesSpan', () => {
	const span = { from: 10, to: 20 };

	it('is true for a cursor inside the span', () => {
		expect(selectionTouchesSpan([{ from: 15, to: 15 }], span)).toBe(true);
	});

	it('is true at either endpoint', () => {
		expect(selectionTouchesSpan([{ from: 10, to: 10 }], span)).toBe(true);
		expect(selectionTouchesSpan([{ from: 20, to: 20 }], span)).toBe(true);
	});

	it('is false just outside either end', () => {
		expect(selectionTouchesSpan([{ from: 9, to: 9 }], span)).toBe(false);
		expect(selectionTouchesSpan([{ from: 21, to: 21 }], span)).toBe(false);
	});

	it('is true for a selection that straddles the span entirely', () => {
		expect(selectionTouchesSpan([{ from: 0, to: 100 }], span)).toBe(true);
	});

	it('is true when any one of several ranges touches', () => {
		expect(
			selectionTouchesSpan(
				[
					{ from: 0, to: 1 },
					{ from: 15, to: 15 },
				],
				span,
			),
		).toBe(true);
	});

	it('is false for an empty selection list', () => {
		expect(selectionTouchesSpan([], span)).toBe(false);
	});
});

describe('selectionConfinedTo', () => {
	const bounds = { from: 10, to: 20 };

	it('is true for a cursor well inside', () => {
		expect(selectionConfinedTo([{ from: 15, to: 15 }], bounds)).toBe(true);
	});

	it('is true at the exact boundaries', () => {
		expect(selectionConfinedTo([{ from: 10, to: 20 }], bounds)).toBe(true);
	});

	it('is false when any range escapes', () => {
		expect(selectionConfinedTo([{ from: 9, to: 15 }], bounds)).toBe(false);
		expect(selectionConfinedTo([{ from: 15, to: 21 }], bounds)).toBe(false);
	});

	it('requires every range to be inside, not just one', () => {
		expect(
			selectionConfinedTo(
				[
					{ from: 12, to: 14 },
					{ from: 50, to: 51 },
				],
				bounds,
			),
		).toBe(false);
	});

	it('is vacuously true for an empty selection list', () => {
		// `every` on an empty list is true; the caller only reaches this after
		// selectionTouchesSpan has already returned true, so it cannot fire.
		expect(selectionConfinedTo([], bounds)).toBe(true);
	});
});
