import {
	effectiveAuthoredLabel,
	effectiveAuthoredView,
	InactiveBehavior,
	normalizeLabel,
	ParsedNote,
	ResponsiveMode,
	VariantBlock,
	ViewMode,
} from './types';

export interface SectionVariantsSettings {
	defaultView: ViewMode;
	defaultMinWidth: string;
	livePreviewInactive: InactiveBehavior;
	responsiveBehavior: ResponsiveMode;
	stickyControlEnabled: boolean;
	toolbarVisibility: 'hover' | 'always';
	automaticBlockIds: boolean;
	aliases: string[];
	exportState: 'authored' | 'current';
	showIndicators: boolean;
}

export const DEFAULT_SETTINGS: SectionVariantsSettings = {
	defaultView: 'toggle',
	defaultMinWidth: '320px',
	livePreviewInactive: 'collapsed',
	responsiveBehavior: 'responsive',
	stickyControlEnabled: true,
	toolbarVisibility: 'hover',
	automaticBlockIds: false,
	aliases: ['variants'],
	exportState: 'authored',
	showIndicators: true,
};

export interface PersistedBlockState {
	selectedLabel?: string;
	view?: ViewMode;
	savedHiddenLabels?: string[];
	toolbarPinned?: boolean;
	inactiveBehavior?: InactiveBehavior;
}

export interface PersistedNoteState {
	globalLabel?: string;
	globalView?: ViewMode;
	stickyVisible?: boolean;
	inactiveBehavior?: InactiveBehavior;
	blocks: Record<string, PersistedBlockState>;
}

export interface ResolvedBlockState {
	selectedLabel: string;
	view: ViewMode;
	responsive: ResponsiveMode;
	minWidth: string;
	widths?: string;
	hiddenLabels: Set<string>;
	toolbarPinned: boolean;
	inactiveBehavior: InactiveBehavior;
	differsFromAuthored: boolean;
}

export function createNoteState(): PersistedNoteState {
	return { blocks: {} };
}

export function resolveBlockState(
	block: VariantBlock,
	note: PersistedNoteState | undefined,
	settings: SectionVariantsSettings,
	sessionHiddenLabels?: ReadonlySet<string>,
): ResolvedBlockState {
	const persisted = note?.blocks[block.identityKey];
	const authoredLabel = effectiveAuthoredLabel(block);
	const selectedLabel =
		findAuthoredLabel(block, persisted?.selectedLabel) ??
		findAuthoredLabel(block, note?.globalLabel) ??
		authoredLabel;
	const authoredView = effectiveAuthoredView(block, settings.defaultView);
	const view = persisted?.view ?? note?.globalView ?? authoredView;
	const hiddenLabels = new Set(
		[...(sessionHiddenLabels ?? persisted?.savedHiddenLabels ?? [])].map(
			normalizeLabel,
		),
	);
	return {
		selectedLabel,
		view,
		responsive: block.attributes.responsive ?? settings.responsiveBehavior,
		minWidth: block.attributes.minWidth ?? settings.defaultMinWidth,
		widths: block.attributes.widths,
		hiddenLabels,
		toolbarPinned: persisted?.toolbarPinned ?? false,
		inactiveBehavior:
			persisted?.inactiveBehavior ??
			note?.inactiveBehavior ??
			settings.livePreviewInactive,
		differsFromAuthored:
			normalizeLabel(selectedLabel) !== normalizeLabel(authoredLabel) ||
			view !== authoredView,
	};
}

export function applyGlobalLabel(
	note: PersistedNoteState,
	parsed: ParsedNote,
	settings: SectionVariantsSettings,
	label: string,
): { applied: number; skipped: number } {
	const before = new Map(
		parsed.blocks.map((block) => [
			block.identityKey,
			resolveBlockState(block, note, settings).selectedLabel,
		]),
	);
	const normalized = normalizeLabel(label);
	note.globalLabel = label;
	let applied = 0;
	let skipped = 0;
	for (const block of parsed.blocks) {
		const matches = block.variants.some(
			(variant) => variant.normalizedLabel === normalized,
		);
		const persisted = ensureBlockState(note, block.identityKey);
		if (matches) {
			delete persisted.selectedLabel;
			applied += 1;
			continue;
		}
		const prior = before.get(block.identityKey);
		const after = resolveBlockState(block, note, settings).selectedLabel;
		if (prior && normalizeLabel(prior) !== normalizeLabel(after)) {
			persisted.selectedLabel = prior;
		}
		pruneBlockState(note, block.identityKey);
		skipped += 1;
	}
	return { applied, skipped };
}

export function applyGlobalView(
	note: PersistedNoteState,
	parsed: ParsedNote,
	view: ViewMode,
): void {
	note.globalView = view;
	for (const block of parsed.blocks) {
		const state = note.blocks[block.identityKey];
		if (!state) continue;
		delete state.view;
		pruneBlockState(note, block.identityKey);
	}
}

export function ensureBlockState(
	note: PersistedNoteState,
	identityKey: string,
): PersistedBlockState {
	note.blocks[identityKey] ??= {};
	return note.blocks[identityKey];
}

export function pruneBlockState(
	note: PersistedNoteState,
	identityKey: string,
): void {
	const state = note.blocks[identityKey];
	if (!state) return;
	if (
		state.selectedLabel === undefined &&
		state.view === undefined &&
		state.savedHiddenLabels === undefined &&
		state.toolbarPinned === undefined &&
		state.inactiveBehavior === undefined
	) {
		delete note.blocks[identityKey];
	}
}

export function findAuthoredLabel(
	block: VariantBlock,
	label: string | undefined,
): string | undefined {
	if (!label) return undefined;
	const normalized = normalizeLabel(label);
	return block.variants.find(
		(variant) => variant.normalizedLabel === normalized,
	)?.label;
}
