export interface ColumnRowPosition {
	laterRow: boolean;
	rowStart: boolean;
	rowEnd: boolean;
}

const DEFAULT_COLUMN_WIDTH = 320;

export function activeColumnWidths(
	widths: string | undefined,
	responsive: string,
	availableWidth: number,
	visibleCount: number,
): string | undefined {
	if (!widths || responsive !== 'responsive' || visibleCount < 1) return undefined;
	return availableWidth >= DEFAULT_COLUMN_WIDTH * visibleCount
		? widths
		: undefined;
}

export function syncColumnGrid(
	content: HTMLElement,
	widths: string | undefined,
	responsive: string,
	visibleCount: number,
): void {
	const active = activeColumnWidths(
		widths,
		responsive,
		content.clientWidth,
		visibleCount,
	);
	if (
		active &&
		!/[;{}]/u.test(active) &&
		content.ownerDocument.defaultView?.CSS?.supports(
			'grid-template-columns',
			active,
		)
	) {
		content.style.gridTemplateColumns = active;
	} else content.style.removeProperty('grid-template-columns');
	content.toggleClass('section-variants-columns-stack', responsive === 'stack');
	content.toggleClass('section-variants-columns-scroll', responsive === 'scroll');
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
		rowEnd:
			index === tops.length - 1 || (tops[index + 1] ?? top) > top + 1,
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
			'section-variants-column-row-end',
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
		panel.toggleClass(
			'section-variants-column-row-end',
			position.rowEnd,
		);
	});
}
