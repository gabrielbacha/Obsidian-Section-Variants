import { FenceToken } from '../core/types';

export interface SectionLineRange {
	lineStart: number;
	lineEnd: number;
}

/** Exact, order-preserving mapping restricted to one rendered source section. */
export function mapSectionFenceTexts(
	fences: readonly FenceToken[],
	range: SectionLineRange,
	texts: readonly string[],
): FenceToken[] | undefined {
	const candidates = fences.filter(
		(fence) =>
			fence.lineStart >= range.lineStart && fence.lineStart <= range.lineEnd,
	);
	if (candidates.length !== texts.length) return undefined;
	return candidates.every((fence, index) => fence.text === texts[index])
		? candidates
		: undefined;
}
