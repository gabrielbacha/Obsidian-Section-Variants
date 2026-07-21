import { ResolvedBlockState } from '../core/state-model';
import {
	effectiveAuthoredLabel,
	effectiveAuthoredView,
	normalizeLabel,
	VariantBlock,
	VariantSection,
	ViewMode,
} from '../core/types';

export type ExportState = 'authored' | 'current';

export function selectExportVariants(
	block: VariantBlock,
	current: ResolvedBlockState,
	stateMode: ExportState,
	defaultView: ViewMode,
): { view: ViewMode; variants: VariantSection[] } {
	const view =
		stateMode === 'authored'
			? effectiveAuthoredView(block, defaultView)
			: current.view;
	const selected =
		stateMode === 'authored'
			? effectiveAuthoredLabel(block)
			: current.selectedLabel;
	const variants =
		view === 'toggle'
			? block.variants.filter(
					(variant) => variant.normalizedLabel === normalizeLabel(selected),
				)
			: block.variants.filter(
					(variant) =>
						stateMode === 'authored' ||
						!current.hiddenLabels.has(variant.normalizedLabel),
				);
	return { view, variants };
}
