import { App } from 'obsidian';
import { ParsedNote, VariantBlock } from './core/types';
import { StateStore } from './state/store';

export interface SectionVariantsHost {
	app: App;
	store: StateStore;
	parse(source: string): ParsedNote;
	refreshAllViews(path?: string): void;
	openBlockConfiguration(path: string, block: VariantBlock): void;
	openRenameVariant(path: string, block: VariantBlock): void;
	ensurePersistentIdentity(
		path: string,
		block: VariantBlock,
	): Promise<VariantBlock | undefined>;
	addStableBlockId(path: string, block: VariantBlock): Promise<void>;
	fixBlock(path: string, block: VariantBlock): Promise<void>;
}
