import { Text } from '@codemirror/state';

export interface Span {
	from: number;
	to: number;
}

/**
 * Range covering a fence line *including its trailing line break*.
 *
 * Excluding the break left the fence line present as an empty, zero-width but
 * still clickable line — the "blank space" users would try to delete, landing
 * the caret inside hidden text. Swallowing the break removes the line entirely.
 *
 * Bounds come from `doc.lineAt` rather than the parser's offsets because
 * `parser.ts` strips `\r` before computing them, so every token's `to` is short
 * by one on a CRLF document.
 *
 * Ranges built this way abut exactly and never overlap: a fence on line N
 * yields `[N.from, N+1.from)`.
 */
export function fenceLineRange(doc: Text, from: number): Span {
	const line = doc.lineAt(from);
	// A fence on the final line with no trailing break has no phantom line
	// after it, so there is nothing to swallow.
	return { from: line.from, to: line.to < doc.length ? line.to + 1 : line.to };
}

/** Line-aligned bounds for a whole block or variant, CRLF-safe. */
export function blockSpan(doc: Text, from: number, to: number): Span {
	return { from: doc.lineAt(from).from, to: doc.lineAt(to).to };
}

/** True when any selection range overlaps the span, endpoints included. */
export function selectionTouchesSpan(
	ranges: readonly Span[],
	span: Span,
): boolean {
	return ranges.some((range) => range.from <= span.to && range.to >= span.from);
}

/** True when every selection range lies within the bounds, endpoints included. */
export function selectionConfinedTo(
	ranges: readonly Span[],
	bounds: Span,
): boolean {
	return ranges.every(
		(range) => range.from >= bounds.from && range.to <= bounds.to,
	);
}
