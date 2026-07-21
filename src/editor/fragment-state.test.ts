import { EditorState, Facet, StateField } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { deriveFragmentState } from './fragment-state';

describe('inline Live Preview fragment state', () => {
	it('preserves owner configuration while recalculating fields for the fragment', () => {
		const marker = Facet.define<string, readonly string[]>({ combine: (values) => values });
		const documentLength = StateField.define<number>({
			create: (state) => state.doc.length,
			update: (_value, transaction) => transaction.newDoc.length,
		});
		const owner = EditorState.create({
			doc: '# A full note',
			extensions: [documentLength, marker.of('owner')],
		});

		const fragment = deriveFragmentState(owner, '**column**', marker.of('child'));

		expect(fragment.doc.toString()).toBe('**column**');
		expect(fragment.field(documentLength)).toBe(10);
		expect(fragment.facet(marker)).toEqual(['owner', 'child']);
	});
});
