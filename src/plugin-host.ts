import { App } from 'obsidian';
import {
	ParsedNote,
	ResponsiveMode,
	VariantBlock,
	ViewMode,
} from './core/types';
import { StateStore } from './state/store';

export interface SectionVariantsHost {
	app: App;
	store: StateStore;
	parse(source: string): ParsedNote;
	refreshAllViews(path?: string): void;
	setBlockName(path: string, block: VariantBlock, name: string, origin?: HTMLElement): void;
	setBlockDefaultLabel(
		path: string,
		block: VariantBlock,
		label: string,
		origin?: HTMLElement,
	): void;
	setBlockAuthoredView(
		path: string,
		block: VariantBlock,
		view: ViewMode,
		origin?: HTMLElement,
	): void;
	openColumnRatios(path: string, block: VariantBlock, origin?: HTMLElement): void;
	setBlockResponsive(
		path: string,
		block: VariantBlock,
		responsive: ResponsiveMode,
		origin?: HTMLElement,
	): void;
	openAddVariant(path: string, block: VariantBlock, origin?: HTMLElement): void;
	openDeleteVariant(
		path: string,
		block: VariantBlock,
		label: string,
		origin?: HTMLElement,
	): void;
	openRenameVariant(
		path: string,
		block: VariantBlock,
		label: string,
		origin?: HTMLElement,
	): void;
	ensurePersistentIdentity(
		path: string,
		block: VariantBlock,
	): Promise<VariantBlock | undefined>;
	addStableBlockId(path: string, block: VariantBlock): Promise<void>;
	fixBlock(path: string, block: VariantBlock): Promise<void>;
}
