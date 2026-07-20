/** Fallback when a length cannot be resolved, matching the PRD §7.2 default. */
const DEFAULT_MIN_WIDTH_PX = 320;

/**
 * Resolve a CSS length to pixels in the context of `reference`.
 *
 * `Number.parseFloat` alone read "20rem" as 20 and compared it against a pixel
 * width, so `auto` view almost always chose columns. Settings and the block
 * configuration modal both accept rem/em/ch, so units have to be honoured.
 */
export function resolveLengthPx(
	value: string | undefined,
	reference: HTMLElement,
): number {
	if (!value) return DEFAULT_MIN_WIDTH_PX;

	const trimmed = value.trim();
	const asPx = /^(\d+(?:\.\d+)?)px$/u.exec(trimmed);
	if (asPx?.[1]) return Number.parseFloat(asPx[1]);

	// Appended inside the reference so font-relative units resolve against the
	// same inherited font size the block actually renders with.
	const probe = reference.createDiv({ cls: 'section-variants-length-probe' });
	probe.setCssProps({ width: trimmed });
	const resolved = probe.getBoundingClientRect().width;
	probe.remove();

	return resolved > 0 ? resolved : DEFAULT_MIN_WIDTH_PX;
}

/**
 * PRD §7.2: two variants stay side by side when possible; three or more use
 * equal-width tracks until stacking is required. So the width needed never
 * exceeds three columns' worth regardless of variant count.
 */
export const MAX_SIDE_BY_SIDE_COLUMNS = 3;

export function hasRoomForColumns(
	availableWidth: number,
	minWidthPx: number,
	variantCount: number,
): boolean {
	const columns = Math.min(variantCount, MAX_SIDE_BY_SIDE_COLUMNS);
	return availableWidth > 0 && availableWidth >= minWidthPx * columns;
}
