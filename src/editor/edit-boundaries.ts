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
		const from = Math.max(cursor, child.range.from);
		if (from >= variant.content.from && from <= contentEnd) {
			spans.push({ from: cursor, to: from });
		}
		cursor = Math.max(cursor, child.range.to);
	}
	if (cursor <= contentEnd) {
		spans.push({ from: cursor, to: contentEnd });
	}
	return spans;
}

/**
 * Text outside valid blocks remains free-form. A change touching a valid block
 * must fit wholly inside one currently editable prose island.
 */
export function changesAreWithinEditableSpans(
	parsed: ParsedNote,
	spans: readonly EditableSpan[],
	changes: readonly DocumentChange[],
): boolean {
	return changes.every((change) => {
		const touchesGuardedBlock = parsed.blocks.some(
			(block) =>
				block.valid &&
				block.closing !== undefined &&
				changeTouchesRange(change, block.range.from, block.range.to),
		);
		if (!touchesGuardedBlock) return true;
		return spans.some((span) => {
			if (change.from < span.from || change.to > span.to) return false;
			if (!span.requiresTrailingLineBreak) return true;
			return (
				change.from === change.to && (change.inserted ?? '').endsWith('\n')
			);
		});
	});
}

function changeTouchesRange(
	change: DocumentChange,
	from: number,
	to: number,
): boolean {
	if (change.from === change.to) {
		return change.from > from && change.from < to;
	}
	return change.from < to && change.to > from;
}
