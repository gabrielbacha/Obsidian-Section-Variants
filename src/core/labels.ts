import { VariantBlock } from './types';

/**
 * Every distinct label across the given blocks, ordered by first appearance and
 * de-duplicated case-insensitively while preserving authored casing (PRD §9).
 */
export function unionLabels(blocks: VariantBlock[]): string[] {
	const seen = new Set<string>();
	const labels: string[] = [];
	for (const block of blocks) {
		for (const variant of block.variants) {
			if (seen.has(variant.normalizedLabel)) continue;
			seen.add(variant.normalizedLabel);
			labels.push(variant.label);
		}
	}
	return labels;
}
