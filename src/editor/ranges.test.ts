import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { blockSpan } from './ranges';

const doc = (source: string): Text => Text.of(source.split('\n'));

describe('line-aligned live preview replacements', () => {
	it('expands whole replacements to line boundaries', () => {
		const source = doc('head\n:::: variants\nbody\n::::\ntail');
		expect(blockSpan(source, 7, 31)).toEqual({ from: 5, to: 33 });
	});

	it('preserves CRLF content inside the atomic replacement', () => {
		const source = 'head\r\n:::: variants\r\nbody\r\n::::\r\ntail';
		const range = blockSpan(doc(source), 8, 28);
		expect(source.slice(range.from, range.to)).toBe(
			':::: variants\r\nbody\r\n::::\r',
		);
	});
});
