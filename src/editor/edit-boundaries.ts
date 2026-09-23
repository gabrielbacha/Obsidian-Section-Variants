import { ParsedNote, VariantSection } from '../core/types';

export interface EditableSpan {
	from: number;
	to: number;
	/** A truly empty variant needs a newline before ordinary text is safe. */
	requiresTrailingLineBreak?: boolean;
}

export interface DocumentChange {
	from: number;
	to: number;
	inserted?: string;
}

/**
 * Return the prose islands inside one visible variant. Valid nested blocks are
 * cut out because their own active variants provide the only editable islands
 * inside those widgets.
 */
export function editableSpansForVariant(
	variant: VariantSection,
	source: string,
): EditableSpan[] {
	if (variant.content.from === variant.content.to) {
		return [
			{
				from: variant.content.from,
				to: variant.content.to,
				requiresTrailingLineBreak: true,
			},
		];
	}
	// Keep the newline immediately before the closing fence outside the
	// editable range. Removing it would turn `:::` into ordinary inline text.
	const contentEnd =
		source.charCodeAt(variant.content.to - 1) === 10
			? variant.content.to - 1
			: variant.content.to;
	const children = variant.children
		.filter((child) => child.valid && child.closing)
		.sort((left, right) => left.range.from - right.range.from);
	const spans: EditableSpan[] = [];
	let cursor = variant.content.from;
	for (const child of children) {
		let childBoundary = child.range.from;
		// Protect the line break that makes the nested opening fence a block.
		// Without this, Backspace at the end of the preceding prose island could
		// join the fence onto prose even though the fence text itself is excluded.
		if (
			childBoundary > cursor &&
			source.charCodeAt(childBoundary - 1) === 10
		) {
			childBoundary -= 1;
			if (
				childBoundary > cursor &&
				source.charCodeAt(childBoundary - 1) === 13
			) {
				childBoundary -= 1;
			}
		}
		const from = Math.max(cursor, childBoundary);
		if (from >= variant.content.from && from <= contentEnd) {
			spans.push({ from: cursor, to: from });
		}
		cursor = Math.max(cursor, child.range.to);
		// Likewise, keep the line break after the nested closing fence out of the
		// following prose editor so Delete cannot join following prose to it.
		if (source.charCodeAt(cursor) === 13) cursor += 1;
		if (source.charCodeAt(cursor) === 10) cursor += 1;
	}
	if (cursor <= contentEnd) {
		spans.push({ from: cursor, to: contentEnd });
	}
	return spans;
}

/**
 * Keep hidden variants syntax intact without disabling ordinary outer-editor
 * operations. Changes wholly inside an exposed prose span are safe. A change
 * may also replace a complete root block, which preserves whole-note and
 * cross-block cut/delete/paste behavior.
 */
export function changesRespectVariantBoundaries(
	parsed: ParsedNote,
	spans: readonly EditableSpan[],
	changes: readonly DocumentChange[],
): boolean {
	return changes.every((change) =>
		parsed.roots
			.filter((block) => block.valid && block.closing)
			.filter((block) => changeTouchesRange(change, block.range.from, block.range.to))
			.every((block) => {
				if (change.from <= block.range.from && change.to >= block.range.to) {
					return true;
				}
				if (spans.some((span) => changeFitsSpan(change, span))) return true;
				// Cover the selection with exposed prose and whole nested containers.
				// Hidden siblings and partial fences never contribute a safe span.
				const completeNested = parsed.blocks.filter((nested) =>
					nested !== block && nested.valid && nested.closing &&
					nested.range.from >= block.range.from && nested.range.to <= block.range.to &&
					change.from <= nested.range.from && change.to >= nested.range.to,
				).map((nested) => ({
					from: nested.range.from - (parsed.source[nested.range.from - 1] === '\n' ? 1 : 0),
					to: nested.range.to + (parsed.source[nested.range.to] === '\n' ? 1 : 0),
				}));
				if (!completeNested.length) return false;
				let covered = change.from;
				for (const span of [...spans, ...completeNested].sort((a, b) => a.from - b.from)) {
					if (span.from > covered) break;
					covered = Math.max(covered, span.to);
				}
				return covered >= change.to;
			}),
	);
}

function changeFitsSpan(change: DocumentChange, span: EditableSpan): boolean {
	if (change.from < span.from || change.to > span.to) return false;
	if (!span.requiresTrailingLineBreak) return true;
	// The transaction filter adds the separating newline to the first input.
	return change.from === change.to;
}

function changeTouchesRange(
	change: DocumentChange,
	from: number,
	to: number,
): boolean {
	if (change.from === change.to) return change.from > from && change.from < to;
	return change.from < to && change.to > from;
}
