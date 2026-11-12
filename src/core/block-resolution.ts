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

/** Deferred structure changes need a unique stable ID or the unchanged complete source. */
export function resolveMutationBlock(target: VariantBlock,candidates:readonly VariantBlock[]):VariantBlock|undefined{
 const stable=target.attributes.id??target.blockId;
 if(stable){const matches=candidates.filter(candidate=>(candidate.attributes.id??candidate.blockId)===stable);const current=matches.length===1?matches[0]:undefined;if(!current||target.sourceSnapshot===undefined||current.sourceSnapshot===undefined)return undefined;return target.sourceSnapshot.slice(target.range.from,target.range.to)===current.sourceSnapshot.slice(current.range.from,current.range.to)?current:undefined;}
 if(target.sourceSnapshot===undefined||candidates.some(candidate=>candidate.sourceSnapshot!==target.sourceSnapshot))return undefined;
 const matches=candidates.filter(candidate=>candidate.identityKey===target.identityKey&&candidate.opening.from===target.opening.from&&candidate.range.to===target.range.to);
 return matches.length===1?matches[0]:undefined;
}
