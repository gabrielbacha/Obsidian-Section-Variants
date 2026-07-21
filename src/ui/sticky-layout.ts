export interface VerticalRect {
	top: number;
	bottom: number;
}

/** Return the number of pixels a bottom overlay occupies inside a view. */
export function bottomObstruction(
	view: VerticalRect,
	overlay?: VerticalRect,
): number {
	if (
		!overlay ||
		overlay.bottom <= view.top ||
		overlay.top >= view.bottom ||
		overlay.bottom < view.bottom
	) {
		return 0;
	}
	return Math.ceil(Math.max(0, view.bottom - Math.max(view.top, overlay.top)));
}
