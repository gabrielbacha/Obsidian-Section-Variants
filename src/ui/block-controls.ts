import { setIcon, setTooltip } from 'obsidian';
import { normalizeLabel, VariantBlock, ViewMode } from '../core/types';
import { SectionVariantsHost } from '../plugin-host';
import { blockMarkerTooltip, openBlockMenu } from './block-menu';
import { createSegmentedControl, VIEW_MODE_SEGMENTS } from './segmented-control';
import { createVariantMarker } from './variant-marker';

export interface BlockControlsOptions {
	host: SectionVariantsHost;
	path: string;
	block: VariantBlock;
	parent: HTMLElement;
	mode: 'toggle' | 'columns';
	onSelectLabel: (label: string, event: MouseEvent) => void;
}

export function createBlockControls({
	host,
	path,
	block,
	parent,
	mode,
	onSelectLabel,
}: BlockControlsOptions): void {
	const state = host.store.resolve(path, block);
	createVariantMarker(parent, {
		ariaLabel: 'Open variants menu',
		tooltip: blockMarkerTooltip(host, path, block),
		differs: state.differsFromAuthored && host.store.settings.showIndicators,
		onClick: (event) => openBlockMenu(host, path, block, event),
	});
	const reveal = parent.createDiv({ cls: 'section-variants-reveal-controls' });
	const active = block.variants.find(
		(variant) => variant.normalizedLabel === normalizeLabel(state.selectedLabel),
	);
	createSegmentedControl(reveal, {
		cls: 'section-variants-labels',
		ariaLabel: mode === 'columns' ? 'Visible columns' : 'Variant',
		value: mode === 'toggle' ? active?.label : undefined,
		activeValues:
			mode === 'columns'
				? new Set(
						block.variants
							.filter(
								(variant) =>
									!state.hiddenLabels.has(variant.normalizedLabel),
							)
							.map((variant) => variant.label),
					)
				: undefined,
		options: block.variants.map((variant) => ({
			value: variant.label,
			text: variant.label,
			label:
				mode === 'columns'
					? `${state.hiddenLabels.has(variant.normalizedLabel) ? 'Show' : 'Hide'} ${variant.label} column`
					: variant.label,
			tooltip:
				mode === 'columns'
					? `${state.hiddenLabels.has(variant.normalizedLabel) ? 'Show' : 'Hide'} ${variant.label} column`
					: `${variant.label}\nShift-select to apply across the note`,
		})),
		onSelect: (label, event) => {
			if (mode === 'columns') host.store.toggleHidden(path, block, label);
			else onSelectLabel(label, event);
		},
	});
	reveal.createSpan({ cls: 'section-variants-control-divider' });
	createSegmentedControl<ViewMode>(reveal, {
		cls: 'section-variants-views',
		ariaLabel: 'View',
		value: state.view,
		options: VIEW_MODE_SEGMENTS,
		onSelect: (view) => void selectView(host, path, block, view),
	});
	if (state.hiddenLabels.size > 0) {
		const restore = reveal.createEl('button', {
			type: 'button',
			cls: 'clickable-icon section-variants-restore-columns',
			attr: { 'aria-label': 'Restore hidden columns' },
		});
		setIcon(restore, 'eye');
		setTooltip(restore, `Restore ${state.hiddenLabels.size} hidden column${state.hiddenLabels.size === 1 ? '' : 's'}`);
		restore.addEventListener('click', () => host.store.restoreColumns(path, block));
	}
}

async function selectView(
	host: SectionVariantsHost,
	path: string,
	block: VariantBlock,
	view: ViewMode,
): Promise<void> {
	const persistent = await host.ensurePersistentIdentity(path, block);
	if (!persistent) return;
	host.store.setView(path, persistent, view);
}
