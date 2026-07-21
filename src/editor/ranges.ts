import { Text } from '@codemirror/state';

export interface LineSpan {
	from: number;
	to: number;
}

/** Cover a complete line, including its trailing line break when present. */
export function fenceLineRange(doc: Text, offset: number): LineSpan {
	const line = doc.lineAt(Math.min(offset, doc.length));
	return {
		from: line.from,
		to: line.to < doc.length ? line.to + 1 : line.to,
	};
}

/** Expand two offsets to complete line content without crossing the next line. */
export function blockSpan(doc: Text, from: number, to: number): LineSpan {
	return {
		from: doc.lineAt(Math.min(from, doc.length)).from,
		to: doc.lineAt(Math.min(to, doc.length)).to,
	};
}
