import { DocumentChange, EditableSpan } from './edit-boundaries';

export interface RelativeChange {
	from: number;
	to: number;
	inserted: string;
}

export interface SelectionRange {
	anchor: number;
	head: number;
}

/** Map one child editor transaction back into its absolute outer-note range. */
export function mapInlineChanges(
	span: EditableSpan,
	changes: readonly RelativeChange[],
): DocumentChange[] | undefined {
	const mapped = changes.map((change) => ({
		from: span.from + change.from,
		to: span.from + change.to,
		inserted: change.inserted,
	}));
	if (!span.requiresTrailingLineBreak) return mapped;
	const only = mapped[0];
	if (mapped.length !== 1 || !only || only.from !== only.to) return undefined;
	only.inserted = `${only.inserted ?? ''}\n`;
	return mapped;
}

/** Map a child selection to its absolute owning-note positions. */
export function mapInlineSelection(
	span: EditableSpan,
	ranges: readonly SelectionRange[],
): SelectionRange[] {
	return ranges.map((range) => ({
		anchor: span.from + range.anchor,
		head: span.from + range.head,
	}));
}

/** Recover a child selection only when every endpoint belongs to this island. */
export function selectionWithinInlineSpan(
	span: EditableSpan,
	ranges: readonly SelectionRange[],
): SelectionRange[] | undefined {
	if (
		ranges.some(
			(range) =>
				range.anchor < span.from ||
				range.anchor > span.to ||
				range.head < span.from ||
				range.head > span.to,
		)
	) {
		return undefined;
	}
	return ranges.map((range) => ({
		anchor: range.anchor - span.from,
		head: range.head - span.from,
	}));
}
