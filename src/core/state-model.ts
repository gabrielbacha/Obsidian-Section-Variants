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
	/** Explicit opt-out from note-wide label and view changes. */
	globalMode?: 'local';
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
	const selectedLabel =
		findAuthoredLabel(block, persisted?.selectedLabel) ??
		(persisted?.labelMode === 'authored' || persisted?.globalMode === 'local'
			? authoredLabel
			: findAuthoredLabel(block, note?.globalLabel)) ??
		authoredLabel;
	const authoredView = effectiveAuthoredView(block, settings.defaultView);
	const view =
		persisted?.view ??
		(persisted?.viewMode === 'authored' || persisted?.globalMode === 'local'
			? authoredView
			: note?.globalView) ??
		authoredView;
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
	settings: SectionVariantsSettings,
	label: string,
): { applied: number; skipped: number } {
	const before = new Map(
		parsed.blocks.filter((block) => block.valid).map((block) => [
			block.identityKey,
			resolveBlockState(block, note, settings).selectedLabel,
		]),
	);
	const normalized = normalizeLabel(label);
	note.globalLabel = label;
	let applied = 0;
	let skipped = 0;
	for (const block of parsed.blocks.filter((candidate) => candidate.valid)) {
		const existing = note.blocks[block.identityKey];
		if (existing?.globalMode === 'local') {
			skipped += 1;
			continue;
		}
		const matches = block.variants.some(
			(variant) => variant.normalizedLabel === normalized,
		);
		const persisted = ensureBlockState(note, block.identityKey);
		delete persisted.labelMode;
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
	for (const block of parsed.blocks.filter((candidate) => candidate.valid)) {
		const state = note.blocks[block.identityKey];
		if (!state || state.globalMode === 'local') continue;
		delete state.view;
		delete state.viewMode;
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
