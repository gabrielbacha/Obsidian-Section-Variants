export interface ColumnRowPosition {
	laterRow: boolean;
	rowStart: boolean;
}

/** Classify visual grid rows from direct-panel top offsets. */
export function classifyColumnRows(
	tops: readonly number[],
): ColumnRowPosition[] {
	const firstTop = tops[0];
	return tops.map((top, index) => ({
		laterRow:
			firstTop !== undefined && top > firstTop + 1,
		rowStart:
			index > 0 && top > (tops[index - 1] ?? top) + 1,
	}));
}

/** Apply separator classes from the columns' actual rendered grid rows. */
export function syncColumnSeparators(content: HTMLElement): void {
	const allPanels = Array.from(content.children).filter((child) =>
		child.classList.contains('section-variants-panel'),
	) as HTMLElement[];
	for (const panel of allPanels) {
		panel.removeClass(
			'section-variants-column-later-row',
			'section-variants-column-row-start',
		);
	}
	const visiblePanels = allPanels.filter(
		(panel) =>
			!panel.hasClass('is-hidden-column') &&
			panel.getClientRects().length > 0,
	);
	const positions = classifyColumnRows(
		visiblePanels.map((panel) => panel.offsetTop),
	);
	visiblePanels.forEach((panel, index) => {
		const position = positions[index];
		if (!position) return;
		panel.toggleClass(
			'section-variants-column-later-row',
			position.laterRow,
		);
		panel.toggleClass(
			'section-variants-column-row-start',
			position.rowStart,
		);
	});
}
