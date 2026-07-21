import { App } from 'obsidian';
import { ParsedNote, VariantBlock } from './core/types';
import { StateStore } from './state/store';

export interface SectionVariantsHost {
	app: App;
	store: StateStore;
	parse(source: string): ParsedNote;
	refreshAllViews(path?: string): void;
	openBlockConfiguration(path: string, block: VariantBlock): void;
	openAddVariant(path: string, block: VariantBlock): void;
	openDeleteVariant(path: string, block: VariantBlock, label: string): void;
	openRenameVariant(path: string, block: VariantBlock, label: string): void;
	ensurePersistentIdentity(
		path: string,
		block: VariantBlock,
	): Promise<VariantBlock | undefined>;
	addStableBlockId(path: string, block: VariantBlock): Promise<void>;
	fixBlock(path: string, block: VariantBlock): Promise<void>;
}
