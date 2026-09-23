import { normalizeLabel, VariantBlock, VariantSection } from '../core/types';

export interface NativeEditingTarget {
	blockFrom: number;
	label: string;
}

/** Resolve the visible variant on the path to one active columns editor. */
export function editingPathVariant(
	block: VariantBlock,
	target: NativeEditingTarget | null,
): VariantSection | undefined {
	if (!target) return undefined;
	if (block.opening.from === target.blockFrom) {
		const normalized = normalizeLabel(target.label);
		return block.variants.find(
			(variant) => variant.normalizedLabel === normalized,
		);
	}
	if (target.blockFrom <= block.opening.from || target.blockFrom >= block.range.to) {
		return undefined;
	}
	return block.variants.find(
		(variant) =>
			target.blockFrom >= variant.content.from &&
			target.blockFrom <= variant.content.to,
	);
}
