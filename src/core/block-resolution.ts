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
	const positioned = candidates.find(
		(candidate) =>
			candidate.opening.from === target.opening.from &&
			candidate.opening.text === target.opening.text,
	);
	if (positioned) return positioned;
	const targetLabels = new Set(
		target.variants.map((variant) => variant.normalizedLabel),
	);
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
