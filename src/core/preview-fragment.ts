import {textChange} from './text-diff';
import { resolveCurrentBlock } from './block-resolution';
import { ParsedNote, VariantBlock, VariantSection } from './types';

/** Prose runs on either side of nested variants; offsets belong to the note. */
export function previewFragments(variant: VariantSection): { from: number; to: number }[] {
	const children = [...variant.children].sort((a, b) => a.range.from - b.range.from);
	return [...children.map((child, index) => ({
		from: index ? children[index - 1]!.range.to : variant.content.from,
		to: child.range.from,
	})), { from: children[children.length - 1]?.range.to ?? variant.content.from, to: variant.content.to }];
}

/** Reject stale content, then return only the actual changed characters. */
export function previewChange(
	source: string,
	parsed: ParsedNote,
	target: VariantBlock,
	label: string,
	fragmentIndex: number,
	before: string,
	after: string,
): { from: number; to: number; insert: string } {
	const block = resolveCurrentBlock(target, parsed.blocks);
	const variant = block?.valid && block.variants.find(v => v.normalizedLabel === label);
	const range = variant && previewFragments(variant)[fragmentIndex];
	if (!range || source.slice(range.from, range.to) !== before) {
		throw new Error('Preview source no longer matches the note.');
	}
	// A renderer may omit the structural newline preceding a nested/closing fence.
	if (before.endsWith('\n') && !after.endsWith('\n')) after += '\n';
	const change=textChange(before,after);
	return {from:range.from+change.from,to:range.from+change.to,insert:change.insert};
}
