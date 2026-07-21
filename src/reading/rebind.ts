import { VariantBlock } from '../core/types';

/** Match a renderer after a structural edit, falling back to stable note order. */
export function findReboundBlock(
	previousBlocks: readonly VariantBlock[],
	current: VariantBlock,
	nextBlocks: readonly VariantBlock[],
): VariantBlock | undefined {
	const exact = nextBlocks.find(
		(block) => block.identityKey === current.identityKey,
	);
	if (exact) return exact;
	const previousIndex = previousBlocks.findIndex(
		(block) =>
			block.identityKey === current.identityKey ||
			block.opening.from === current.opening.from,
	);
	return previousIndex >= 0 ? nextBlocks[previousIndex] : undefined;
}
