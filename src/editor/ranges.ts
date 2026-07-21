import { Text } from '@codemirror/state';

export interface LineSpan {
	from: number;
	to: number;
}

/** Expand two offsets to complete line content without crossing the next line. */
export function blockSpan(doc: Text, from: number, to: number): LineSpan {
	return {
		from: doc.lineAt(Math.min(from, doc.length)).from,
		to: doc.lineAt(Math.min(to, doc.length)).to,
	};
}
