import {
	effectiveAuthoredLabel,
	effectiveAuthoredView,
	normalizeLabel,
	ParsedNote,
	ResponsiveMode,
	VariantBlock,
	ViewMode,
} from './types';

export interface SectionVariantsSettings {
	defaultView: ViewMode;
	defaultMinWidth: string;
	stickyControlEnabled: boolean;
	automaticBlockIds: boolean;
	aliases: string[];
	exportState: 'authored' | 'current';
	showIndicators: boolean;
}

export const DEFAULT_SETTINGS: SectionVariantsSettings = {
	defaultView: 'toggle',
	defaultMinWidth: '320px',
	stickyControlEnabled: true,
	automaticBlockIds: false,
	aliases: ['variants'],
	exportState: 'authored',
	showIndicators: true,
};

export interface PersistedBlockState {
	selectedLabel?: string;
	view?: ViewMode;
	savedHiddenLabels?: string[];
	labelMode?: 'authored';
	viewMode?: 'authored';
	/** Explicit layer choice when persisted local values also exist. */
	globalMode?: 'local' | 'follow';
}

export interface PersistedNoteState {
	globalLabel?: string;
	globalView?: ViewMode;
	stickyVisible?: boolean;
	blocks: Record<string, PersistedBlockState>;
}

export interface ResolvedBlockState {
	selectedLabel: string;
	view: ViewMode;
	responsive: ResponsiveMode;
	minWidth: string;
	widths?: string;
	hiddenLabels: Set<string>;
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
	const localLabel =
		findAuthoredLabel(block, persisted?.selectedLabel) ??
		authoredLabel;
	const followingGlobal = persisted?.globalMode !== 'local';
	const selectedLabel =
		(followingGlobal ? findAuthoredLabel(block, note?.globalLabel) : undefined) ??
		localLabel;
	const authoredView = effectiveAuthoredView(block, settings.defaultView);
	const localView = persisted?.view ?? authoredView;
	const view = (followingGlobal ? note?.globalView : undefined) ?? localView;
	const hiddenLabels = new Set(
		[...(sessionHiddenLabels ?? persisted?.savedHiddenLabels ?? [])].map(
			normalizeLabel,
		),
	);
	return {
		selectedLabel,
		view,
		responsive: block.attributes.responsive ?? 'responsive',
		minWidth: block.attributes.minWidth ?? settings.defaultMinWidth,
		widths: block.attributes.widths,
		hiddenLabels,
		differsFromAuthored:
			normalizeLabel(selectedLabel) !== normalizeLabel(authoredLabel) ||
			view !== authoredView,
	};
}

export function applyGlobalLabel(
	note: PersistedNoteState,
	parsed: ParsedNote,
	label: string,
): { applied: number; skipped: number } {
	const normalized = normalizeLabel(label);
	note.globalLabel = label;
	let applied = 0;
	let skipped = 0;
	for (const block of parsed.blocks.filter((candidate) => candidate.valid)) {
		if (note.blocks[block.identityKey]?.globalMode === 'local') {
			skipped += 1;
			continue;
		}
		const matches = block.variants.some(
			(variant) => variant.normalizedLabel === normalized,
		);
		if (matches) {
			applied += 1;
			continue;
		}
		skipped += 1;
	}
	return { applied, skipped };
}

export function applyGlobalView(
	note: PersistedNoteState,
	view: ViewMode,
): void {
	note.globalView = view;
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
		state.labelMode === undefined &&
		state.viewMode === undefined &&
		state.globalMode === undefined
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
