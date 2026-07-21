import { VariantBlock } from '../core/types';

/** Absolute coordinates that invalidate widgets after edits above a block. */
export function widgetPositionIdentity(block: VariantBlock): string {
	return `${block.opening.from}:${block.closing?.to ?? -1}`;
}
