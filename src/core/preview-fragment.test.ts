import { describe, expect, it } from 'vitest';
import { parseNote } from './parser';
import { previewChange, previewFragments } from './preview-fragment';

const source = ':::: {.variants #one view="columns"}\n::: A\n- [ ] Task\n:::\n::: B\nOther\n:::\n::::\n';

describe('native preview edits', () => {
	it('rebinds to current source offsets and changes only the checkbox', () => {
		const shifted = 'Prefix\n' + source;
		const change = previewChange(shifted, parseNote(shifted), parseNote(source).blocks[0]!, 'a', 0, '- [ ] Task\n', '- [x] Task\n');
		expect(change).toEqual({ from: shifted.indexOf('[ ]') + 1, to: shifted.indexOf('[ ]') + 2, insert: 'x' });
	});
	it('rejects stale content instead of overwriting newer edits', () => {
		const newer = source.replace('Task', 'Changed');
		expect(() => previewChange(newer, parseNote(newer), parseNote(source).blocks[0]!, 'a', 0, '- [ ] Task\n', '- [x] Task\n')).toThrow();
	});
	it('rejects missing variants and deleted targets', () => {
		for (const [text, label] of [[source, 'missing'], ['Unrelated text', 'a']]) {
			expect(() => previewChange(text!, parseNote(text!), parseNote(source).blocks[0]!, label!, 0, '- [ ] Task\n', '- [x] Task\n')).toThrow();
		}
	});
	it('preserves the newline separating content from its closing fence', () => {
		const change = previewChange(source, parseNote(source), parseNote(source).blocks[0]!, 'a', 0, '- [ ] Task\n', 'New');
		const next = source.slice(0, change.from) + change.insert + source.slice(change.to);
		expect(next).toContain('New\n:::\n::: B');
		expect(parseNote(next).blocks[0]?.valid).toBe(true);
	});
	it('keeps nested blocks outside prose fragments', () => {
		const nested = ':::::: {.variants #outer}\n::::: A\nBefore\n' + source + 'After\n:::::\n::::: B\nOther\n:::::\n::::::\n';
		const parsed = parseNote(nested);
		const block = parsed.roots[0]!;
		const ranges = previewFragments(block.variants[0]!);
		expect(ranges.map(r => nested.slice(r.from, r.to))).toEqual(['Before\n', '\nAfter\n']);
		const change = previewChange(nested, parsed, block, 'a', 1, '\nAfter\n', '\nAfter changed\n');
		expect(nested.slice(0, change.from) + change.insert + nested.slice(change.to)).toContain(source);
	});
});
