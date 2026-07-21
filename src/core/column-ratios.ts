const SIMPLE_TRACK = /^(\d+(?:\.\d+)?)(?:fr|%)$/u;

/** Read ratios previously saved as simple fractional or percentage tracks. */
export function parseColumnRatios(
	widths: string | undefined,
	count: number,
): number[] | undefined {
	if (!widths) return Array.from({ length: count }, () => 1);
	const tokens = widths.trim().split(/\s+/u);
	if (tokens.length !== count) return undefined;
	const values = tokens.map((token) => {
		const match = SIMPLE_TRACK.exec(token);
		return match?.[1] ? Number.parseFloat(match[1]) : Number.NaN;
	});
	return values.every((value) => Number.isFinite(value) && value > 0)
		? values
		: undefined;
}

/** Serialize one positive ratio per variant. Equal ratios use the default grid. */
export function serializeColumnRatios(
	values: readonly number[],
): string | undefined {
	if (
		values.length === 0 ||
		values.some((value) => !Number.isFinite(value) || value <= 0)
	) {
		return undefined;
	}
	if (values.every((value) => value === values[0])) return undefined;
	return values.map((value) => `${formatRatio(value)}fr`).join(' ');
}

/** Keep authored ratios attached to their variants when columns are hidden. */
export function visibleColumnWidths(
	widths: string | undefined,
	variantCount: number,
	visibleIndexes: readonly number[],
): string | undefined {
	if (!widths) return undefined;
	const ratios = parseColumnRatios(widths, variantCount);
	if (!ratios) return widths;
	return serializeColumnRatios(
		visibleIndexes.flatMap((index) => {
			const ratio = ratios[index];
			return ratio === undefined ? [] : [ratio];
		}),
	);
}

function formatRatio(value: number): string {
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
