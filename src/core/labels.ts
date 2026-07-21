import { normalizeLabel, VariantBlock } from './types';

export interface LabelCatalogEntry {
	label: string;
	count: number;
	firstIndex: number;
}

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

/** Current-note labels ranked by frequency, then authored order. */
export function collectLabelCatalog(
	blocks: readonly VariantBlock[],
): LabelCatalogEntry[] {
	const entries = new Map<string, LabelCatalogEntry>();
	let index = 0;
	for (const block of blocks) {
		if (!block.valid) continue;
		for (const variant of block.variants) {
			const existing = entries.get(variant.normalizedLabel);
			if (existing) existing.count += 1;
			else {
				entries.set(variant.normalizedLabel, {
					label: variant.label,
					count: 1,
					firstIndex: index,
				});
			}
			index += 1;
		}
	}
	return [...entries.values()].sort(
		(left, right) =>
			right.count - left.count || left.firstIndex - right.firstIndex,
	);
}

export function filterLabelCatalog(
	entries: readonly LabelCatalogEntry[],
	query: string,
	excluded: ReadonlySet<string>,
): LabelCatalogEntry[] {
	const normalizedQuery = normalizeLabel(query);
	return entries.filter(
		(entry) =>
			!excluded.has(normalizeLabel(entry.label)) &&
			normalizeLabel(entry.label).includes(normalizedQuery),
	);
}
