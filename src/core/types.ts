export type ViewMode = 'toggle' | 'columns' | 'auto';
export type ResponsiveMode = 'responsive' | 'stack' | 'scroll';

export interface SourceRange {
	from: number;
	to: number;
	lineStart: number;
	lineEnd: number;
}

export interface Diagnostic {
	code: string;
	message: string;
	severity: 'error' | 'warning';
	line: number;
	from: number;
	to: number;
	fix?: 'append-closer';
}

export interface ContainerAttributes {
	id?: string;
	view?: ViewMode;
	defaultLabel?: string;
	widths?: string;
	minWidth?: string;
	responsive?: ResponsiveMode;
}

export interface FenceToken extends SourceRange {
	text: string;
	colonCount: number;
	kind: 'open' | 'close';
}

export interface VariantSection {
	label: string;
	normalizedLabel: string;
	opening: FenceToken;
	closing?: FenceToken;
	content: SourceRange;
	children: VariantBlock[];
}

export interface VariantBlock {
	attributes: ContainerAttributes;
	opening: FenceToken;
	closing?: FenceToken;
	blockId?: string;
	variants: VariantSection[];
	children: VariantBlock[];
	diagnostics: Diagnostic[];
	valid: boolean;
	range: SourceRange;
	identityKey: string;
	/** Previous locale-sensitive keys that may exist in pre-v3 saved data. */
	legacyIdentityKeys: string[];
	identityAmbiguous: boolean;
	fingerprint: string;
	parent?: VariantBlock;
}

export interface ParsedNote {
	source: string;
	lineOffsets: number[];
	blocks: VariantBlock[];
	roots: VariantBlock[];
	fences: FenceToken[];
	diagnostics: Diagnostic[];
}

export interface SerializeOptions {
	labels: string[];
	defaultLabel?: string;
	view?: ViewMode;
	responsive?: ResponsiveMode;
	widths?: string;
	minWidth?: string;
	id?: string;
	depth?: number;
}

export interface SerializedBlock {
	markdown: string;
	firstContentOffset: number;
}

export function normalizeLabel(label: string): string {
	return label.trim().toLowerCase();
}

export function effectiveAuthoredLabel(block: VariantBlock): string {
	const requested = block.attributes.defaultLabel;
	if (requested) {
		const normalized = normalizeLabel(requested);
		const match = block.variants.find(
			(variant) => variant.normalizedLabel === normalized,
		);
		if (match) return match.label;
	}
	return block.variants[0]?.label ?? '';
}

export function effectiveAuthoredView(
	block: VariantBlock,
	fallback: ViewMode,
): ViewMode {
	return block.attributes.view ?? fallback;
}

export function findBlockAtOffset(
	parsed: ParsedNote,
	offset: number,
): VariantBlock | undefined {
	return parsed.blocks
		.filter((block) => offset >= block.range.from && offset <= block.range.to)
		.sort(
			(left, right) =>
				left.range.to - left.range.from - (right.range.to - right.range.from),
		)[0];
}

export function findVariantAtOffset(
	block: VariantBlock,
	offset: number,
): VariantSection | undefined {
	return block.variants.find(
		(variant) =>
			offset >= variant.content.from && offset <= variant.content.to,
	);
}
