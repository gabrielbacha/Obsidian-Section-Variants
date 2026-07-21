import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { blockSpan, fenceLineRange } from './ranges';

const doc = (source: string): Text => Text.of(source.split('\n'));

describe('line-aligned live preview ranges', () => {
	it('includes an LF fence line break', () => {
		const source = ':::\ncontent';
		const range = fenceLineRange(doc(source), 0);
		expect(source.slice(range.from, range.to)).toBe(':::\n');
	});

	it('includes a CRLF fence line break despite parser-style short endpoints', () => {
		const source = ':::\r\ncontent';
		const range = fenceLineRange(doc(source), 0);
		expect(source.slice(range.from, range.to)).toBe(':::\r\n');
	});

	it('makes adjacent fence ranges abut without overlapping', () => {
		const source = doc(':::\r\n::::\r\ntail');
		const first = fenceLineRange(source, 0);
		const second = fenceLineRange(source, first.to);
		expect(first.to).toBe(second.from);
	});

	it('expands whole replacements to line boundaries', () => {
		const source = doc('head\n:::: variants\nbody\n::::\ntail');
		expect(blockSpan(source, 7, 31)).toEqual({ from: 5, to: 33 });
	});
});
