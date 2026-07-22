import { setIcon, setTooltip } from 'obsidian';

export interface VariantMarkerOptions {
	ariaLabel: string;
	tooltip: string;
	onClick: (event: MouseEvent) => void;
	followingGlobal?: boolean;
	mixed?: boolean;
}

/** The one persistent piece of chrome that identifies a variants control. */
export function createVariantMarker(
	parent: HTMLElement,
	options: VariantMarkerOptions,
): HTMLButtonElement {
	const marker = parent.createEl('button', {
		type: 'button',
		cls: 'clickable-icon section-variants-marker',
		attr: { 'aria-label': options.ariaLabel },
	});
	setIcon(marker, 'layers');
	marker.toggleClass('is-following-global', options.followingGlobal ?? false);
	marker.toggleClass('is-mixed', options.mixed ?? false);
	setTooltip(marker, options.tooltip);
	marker.addEventListener('click', options.onClick);
	return marker;
}
