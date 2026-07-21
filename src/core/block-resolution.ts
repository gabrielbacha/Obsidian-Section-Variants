import { VariantBlock } from './types';

/**
 * Rebind a UI action to the latest parsed block before opening a structural
 * modal. Structural edits change fingerprints, while the opening position and
 * pre-existing labels still provide a safe match in the common stale-widget
 * case. Ambiguous structural matches deliberately fail instead of targeting
 * the wrong box.
 */
export function resolveCurrentBlock(
	target: VariantBlock,
	candidates: readonly VariantBlock[],
): VariantBlock | undefined {
	if (target.blockId) {
		const byId = candidates.find((candidate) => candidate.blockId === target.blockId);
		if (byId) return byId;
	}
	const exact = candidates.find(
		(candidate) => candidate.identityKey === target.identityKey,
	);
	if (exact) return exact;
	const targetLabels = new Set(
		target.variants.map((variant) => variant.normalizedLabel),
	);
	const positioned = candidates.filter(
		(candidate) =>
			candidate.opening.from === target.opening.from &&
			[...targetLabels].every((label) =>
				candidate.variants.some(
					(variant) => variant.normalizedLabel === label,
				),
			),
	);
	if (positioned.length === 1) return positioned[0];
	const structural = candidates.filter(
		(candidate) =>
			candidate.opening.text === target.opening.text &&
			[...targetLabels].every((label) =>
				candidate.variants.some(
					(variant) => variant.normalizedLabel === label,
				),
			),
	);
	return structural.length === 1 ? structural[0] : undefined;
}
