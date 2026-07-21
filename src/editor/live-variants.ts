import { normalizeLabel, VariantBlock, VariantSection } from '../core/types';

/** Variants whose prose fragments are directly editable in the resolved view. */
export function liveEditableVariants(
	block: VariantBlock,
	mode: 'toggle' | 'columns',
	selectedLabel: string,
	hiddenLabels: ReadonlySet<string>,
): VariantSection[] {
	if (mode === 'columns') {
		return block.variants.filter(
			(variant) => !hiddenLabels.has(variant.normalizedLabel),
		);
	}
	const selected = normalizeLabel(selectedLabel);
	return block.variants.filter(
		(variant) => variant.normalizedLabel === selected,
	);
}
