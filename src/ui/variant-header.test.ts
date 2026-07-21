import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { variantClipboardText } from './variant-header';

describe('variant clipboard content', () => {
	it('copies exact Markdown content without the variant fences', () => {
		const parsed = parseNote(
			[
				':::: variants',
				'::: A',
				'### Heading',
				'',
				'**Body**',
				':::',
				'::: B',
				'Other',
				':::',
				'::::',
			].join('\n'),
		);
		const variant = parsed.blocks[0]?.variants[0];
		if (!variant) throw new Error('Missing variant fixture');
		expect(variantClipboardText(parsed.source, variant)).toBe(
			'### Heading\n\n**Body**\n',
		);
	});
});
