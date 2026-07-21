import { Notice, Plugin } from 'obsidian';
import {
	applyGlobalLabel,
	applyGlobalView,
	createNoteState,
	DEFAULT_SETTINGS,
	ensureBlockState,
	PersistedBlockState,
	PersistedNoteState,
	pruneBlockState,
	ResolvedBlockState,
	resolveBlockState,
	SectionVariantsSettings,
} from '../core/state-model';
import { randomBytes } from '../core/random';
import {
	normalizeLabel,
	ParsedNote,
	VariantBlock,
	ViewMode,
} from '../core/types';

interface StoredData {
	version: 3;
	vaultToken: string;
	settings: SectionVariantsSettings;
	notes: Record<string, PersistedNoteState>;
	/** Unrecognised data preserved verbatim so an upgrade never loses state. */
	backup?: unknown;
}

export interface StoreChange {
	scope: 'block' | 'note' | 'settings';
	path?: string;
	blockKey?: string;
}

type Listener = (change: StoreChange) => void;

export class StateStore {
	settings: SectionVariantsSettings = { ...DEFAULT_SETTINGS };
	private data: StoredData = createStoredData();
	private readonly listeners = new Set<Listener>();
	private readonly sessionHidden = new Map<string, Set<string>>();
	private readonly editingVariants = new Map<string, string>();
	private saveTimer?: number;

	constructor(private readonly plugin: Plugin) {}

	async load(): Promise<void> {
		const loaded = (await this.plugin.loadData()) as unknown;
		const migration = migrateData(loaded);
		this.data = migration.data;
		if (migration.warning) new Notice(migration.warning, 10000);
		this.settings = this.data.settings;
		this.removeRetiredDevicePreferences();
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getNote(path: string, create = false): PersistedNoteState | undefined {
		if (create) this.data.notes[path] ??= createNoteState();
		return this.data.notes[path];
	}

	resolve(path: string, block: VariantBlock): ResolvedBlockState {
		this.recoverLegacyIdentity(path, block);
		return resolveBlockState(
			block,
			this.getNote(path),
			this.settings,
			this.sessionHidden.get(sessionKey(path, block.identityKey)),
		);
	}

	setSelectedLabel(path: string, block: VariantBlock, label: string): void {
		const state = this.localizeBlock(path, block);
		state.selectedLabel = label;
		delete state.labelMode;
		delete state.viewMode;
		this.changed({ scope: 'block', path, blockKey: block.identityKey });
	}

	followGlobalState(
		path: string,
		block: VariantBlock,
	): { label: boolean; view: boolean } {
		const note = this.getNote(path, true) as PersistedNoteState;
		const label = Boolean(note.globalLabel) && block.variants.some(
			(variant) =>
				variant.normalizedLabel === normalizeLabel(note.globalLabel ?? ''),
		);
		const view = note.globalView !== undefined;
		const state = note.blocks[block.identityKey];
		if (state) {
			delete state.selectedLabel;
			delete state.view;
			delete state.labelMode;
			delete state.viewMode;
			delete state.globalMode;
			pruneBlockState(note, block.identityKey);
		}
		if (resolveBlockState(block, note, this.settings).view !== 'columns') {
			this.editingVariants.delete(sessionKey(path, block.identityKey));
		}
		this.changed({ scope: 'block', path, blockKey: block.identityKey });
		return { label, view };
	}

	isFollowingGlobalState(path: string, block: VariantBlock): boolean {
		this.recoverLegacyIdentity(path, block);
		return this.getNote(path)?.blocks[block.identityKey]?.globalMode !== 'local';
	}

	unfollowGlobalState(path: string, block: VariantBlock): void {
		this.localizeBlock(path, block);
		this.changed({ scope: 'block', path, blockKey: block.identityKey });
	}

	setView(path: string, block: VariantBlock, view: ViewMode): void {
		const state = this.localizeBlock(path, block);
		state.view = view;
		delete state.labelMode;
		delete state.viewMode;
		if (view !== 'columns') {
			this.editingVariants.delete(sessionKey(path, block.identityKey));
		}
		this.changed({ scope: 'block', path, blockKey: block.identityKey });
	}

	applyLabelAcrossNote(
		path: string,
		parsed: ParsedNote,
		label: string,
	): { applied: number; skipped: number } {
		const note = this.getNote(path, true) as PersistedNoteState;
		const result = applyGlobalLabel(note, parsed, this.settings, label);
		this.changed({ scope: 'note', path });
		return result;
	}

	applyViewAcrossNote(path: string, parsed: ParsedNote, view: ViewMode): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		applyGlobalView(note, parsed, view);
		if (view !== 'columns') {
			for (const block of parsed.blocks.filter((candidate) => candidate.valid)) {
				this.editingVariants.delete(sessionKey(path, block.identityKey));
			}
		}
		this.changed({ scope: 'note', path });
	}

	toggleHidden(path: string, block: VariantBlock, label: string): void {
		const key = sessionKey(path, block.identityKey);
		const persisted = this.getNote(path)?.blocks[block.identityKey];
		const hidden =
			this.sessionHidden.get(key) ??
			new Set((persisted?.savedHiddenLabels ?? []).map(normalizeLabel));
		const normalized = normalizeLabel(label);
		if (hidden.has(normalized)) hidden.delete(normalized);
		else {
			hidden.add(normalized);
			const editing = this.editingVariants.get(key);
			if (editing && normalizeLabel(editing) === normalized) {
				this.editingVariants.delete(key);
			}
		}
		this.sessionHidden.set(key, hidden);
		this.emit({ scope: 'block', path, blockKey: block.identityKey });
	}

	toggleColumnAcrossNote(
		path: string,
		parsed: ParsedNote,
		label: string,
	): { visible: boolean; applied: number; skipped: number } {
		const normalized = normalizeLabel(label);
		const validBlocks = parsed.blocks.filter((block) => block.valid);
		const matching = validBlocks.filter((block) =>
			block.variants.some(
				(variant) => variant.normalizedLabel === normalized,
			),
		);
		// Mixed visibility resolves toward showing the column everywhere. Only a
		// fully visible label toggles off across the note.
		const visible = matching.some((block) =>
			this.resolve(path, block).hiddenLabels.has(normalized),
		);
		for (const block of matching) {
			const key = sessionKey(path, block.identityKey);
			const hidden = new Set(this.resolve(path, block).hiddenLabels);
			if (visible) hidden.delete(normalized);
			else {
				hidden.add(normalized);
				const editing = this.editingVariants.get(key);
				if (editing && normalizeLabel(editing) === normalized) {
					this.editingVariants.delete(key);
				}
			}
			this.sessionHidden.set(key, hidden);
		}
		this.emit({ scope: 'note', path });
		return {
			visible,
			applied: matching.length,
			skipped: validBlocks.length - matching.length,
		};
	}

	restoreColumns(path: string, block: VariantBlock): void {
		this.sessionHidden.set(sessionKey(path, block.identityKey), new Set());
		this.emit({ scope: 'block', path, blockKey: block.identityKey });
	}

	saveHidden(path: string, block: VariantBlock): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		const hidden = this.sessionHidden.get(sessionKey(path, block.identityKey));
		const state = ensureBlockState(note, block.identityKey);
		state.savedHiddenLabels = hidden && hidden.size > 0 ? [...hidden] : undefined;
		pruneBlockState(note, block.identityKey);
		this.changed({ scope: 'block', path, blockKey: block.identityKey });
	}

	setStickyVisible(path: string, visible: boolean): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		note.stickyVisible = visible;
		this.changed({ scope: 'note', path });
	}

	isStickyVisible(path: string): boolean {
		return this.getNote(path)?.stickyVisible ?? this.settings.stickyControlEnabled;
	}

	setEditingVariant(path: string, block: VariantBlock, label?: string): void {
		const key = sessionKey(path, block.identityKey);
		if (label) this.editingVariants.set(key, label);
		else this.editingVariants.delete(key);
		this.emit({ scope: 'block', path, blockKey: block.identityKey });
	}

	getEditingVariant(path: string, block: VariantBlock): string | undefined {
		return this.editingVariants.get(sessionKey(path, block.identityKey));
	}

	rekeyBlockState(
		path: string,
		before: VariantBlock,
		after: VariantBlock,
	): void {
		this.rekeyBlockStateInternal(path, before.identityKey, after.identityKey);
		this.changed({ scope: 'note', path });
	}

	migrateRenamedLabels(
		path: string,
		mappings: ReadonlyArray<{ before: VariantBlock; after: VariantBlock }>,
		oldLabel: string,
		newLabel: string,
		acrossNote: boolean,
	): void {
		const note = this.getNote(path);
		const oldNormalized = normalizeLabel(oldLabel);
		const newNormalized = normalizeLabel(newLabel);
		const migrateGlobal =
			acrossNote &&
			note?.globalLabel !== undefined &&
			normalizeLabel(note.globalLabel) === oldNormalized;

		for (const { before, after } of mappings) {
			const priorSelected = note
				? resolveBlockState(before, note, this.settings).selectedLabel
				: undefined;
			this.rekeyBlockStateInternal(
				path,
				before.identityKey,
				after.identityKey,
			);
			const state = note?.blocks[after.identityKey];
			if (state?.selectedLabel && normalizeLabel(state.selectedLabel) === oldNormalized) {
				state.selectedLabel = newLabel;
			} else if (
				state?.labelMode !== 'authored' &&
				!migrateGlobal &&
				priorSelected &&
				normalizeLabel(priorSelected) === oldNormalized
			) {
				ensureBlockState(note as PersistedNoteState, after.identityKey).selectedLabel =
					newLabel;
			}
			if (state?.savedHiddenLabels) {
				state.savedHiddenLabels = replaceNormalizedLabel(
					state.savedHiddenLabels,
					oldNormalized,
					newNormalized,
				);
			}
			const key = sessionKey(path, after.identityKey);
			const hidden = this.sessionHidden.get(key);
			if (hidden?.delete(oldNormalized)) hidden.add(newNormalized);
			const editing = this.editingVariants.get(key);
			if (editing && normalizeLabel(editing) === oldNormalized) {
				this.editingVariants.set(key, newLabel);
			}
		}
		if (migrateGlobal && note) note.globalLabel = newLabel;
		this.changed({ scope: 'note', path });
	}

	migrateDeletedVariant(
		path: string,
		before: VariantBlock,
		after: VariantBlock,
		label: string,
	): void {
		this.rekeyBlockStateInternal(path, before.identityKey, after.identityKey);
		const normalized = normalizeLabel(label);
		const note = this.getNote(path);
		const state = note?.blocks[after.identityKey];
		if (state?.selectedLabel && normalizeLabel(state.selectedLabel) === normalized) {
			delete state.selectedLabel;
		}
		if (state?.savedHiddenLabels) {
			state.savedHiddenLabels = state.savedHiddenLabels.filter(
				(item) => normalizeLabel(item) !== normalized,
			);
			if (state.savedHiddenLabels.length === 0) delete state.savedHiddenLabels;
		}
		if (note) pruneBlockState(note, after.identityKey);
		const key = sessionKey(path, after.identityKey);
		this.sessionHidden.get(key)?.delete(normalized);
		const editing = this.editingVariants.get(key);
		if (editing && normalizeLabel(editing) === normalized) {
			this.editingVariants.delete(key);
		}
		this.changed({ scope: 'note', path });
	}

	resetBlock(path: string, block: VariantBlock): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		const state = ensureBlockState(note, block.identityKey);
		delete state.selectedLabel;
		delete state.view;
		delete state.savedHiddenLabels;
		state.labelMode = 'authored';
		state.viewMode = 'authored';
		state.globalMode = 'local';
		this.sessionHidden.delete(sessionKey(path, block.identityKey));
		this.editingVariants.delete(sessionKey(path, block.identityKey));
		this.changed({ scope: 'block', path, blockKey: block.identityKey });
	}

	private localizeBlock(
		path: string,
		block: VariantBlock,
	): PersistedBlockState {
		const resolved = this.resolve(path, block);
		const note = this.getNote(path, true) as PersistedNoteState;
		const state = ensureBlockState(note, block.identityKey);
		state.selectedLabel = resolved.selectedLabel;
		state.view = resolved.view;
		state.globalMode = 'local';
		delete state.labelMode;
		delete state.viewMode;
		return state;
	}

	resetNote(path: string): void {
		delete this.data.notes[path];
		for (const key of [...this.sessionHidden.keys()]) {
			if (key.startsWith(`${path}\u0000`)) this.sessionHidden.delete(key);
		}
		for (const key of [...this.editingVariants.keys()]) {
			if (key.startsWith(`${path}\u0000`)) this.editingVariants.delete(key);
		}
		this.changed({ scope: 'note', path });
	}

	renameNote(oldPath: string, newPath: string): void {
		const note = this.data.notes[oldPath];
		if (!note) return;
		this.data.notes[newPath] = note;
		delete this.data.notes[oldPath];
		this.moveSessionKeys(oldPath, newPath);
		this.changed({ scope: 'note', path: newPath });
	}

	/**
	 * Reprefix state for every note inside a renamed folder. Obsidian fires a
	 * single rename for the folder, so without this each contained note's state
	 * is stranded under its old key.
	 */
	renameFolder(oldPath: string, newPath: string): void {
		const prefix = `${oldPath}/`;
		for (const path of Object.keys(this.data.notes)) {
			if (!path.startsWith(prefix)) continue;
			const moved = `${newPath}/${path.slice(prefix.length)}`;
			const note = this.data.notes[path];
			if (!note) continue;
			this.data.notes[moved] = note;
			delete this.data.notes[path];
			this.moveSessionKeys(path, moved);
		}
		this.changed({ scope: 'settings' });
	}

	deleteNote(path: string): void {
		if (!this.data.notes[path]) return;
		delete this.data.notes[path];
		this.clearSessionKeys(path);
		this.changed({ scope: 'settings' });
	}

	/** Drop state for every note inside a deleted folder. */
	deleteFolder(path: string): void {
		const prefix = `${path}/`;
		for (const notePath of Object.keys(this.data.notes)) {
			if (!notePath.startsWith(prefix)) continue;
			delete this.data.notes[notePath];
			this.clearSessionKeys(notePath);
		}
		this.changed({ scope: 'settings' });
	}

	/**
	 * Drop persisted state for notes that no longer exist. Without this the
	 * store only ever grows, since deletes that happen while the plugin is
	 * disabled are never observed.
	 */
	collectGarbage(existingPaths: ReadonlySet<string>): number {
		let removed = 0;
		for (const path of Object.keys(this.data.notes)) {
			if (existingPaths.has(path)) continue;
			delete this.data.notes[path];
			this.clearSessionKeys(path);
			removed += 1;
		}
		if (removed > 0) this.changed({ scope: 'settings' });
		return removed;
	}

	private moveSessionKeys(oldPath: string, newPath: string): void {
		for (const map of [this.sessionHidden, this.editingVariants]) {
			for (const key of [...map.keys()]) {
				if (!key.startsWith(`${oldPath}\u0000`)) continue;
				const value = map.get(key);
				if (value === undefined) continue;
				map.delete(key);
				// Cast: both maps are keyed identically, values differ by type.
				(map as Map<string, unknown>).set(
					`${newPath}${key.slice(oldPath.length)}`,
					value,
				);
			}
		}
	}

	private clearSessionKeys(path: string): void {
		for (const map of [this.sessionHidden, this.editingVariants]) {
			for (const key of [...map.keys()]) {
				if (key.startsWith(`${path}\u0000`)) map.delete(key);
			}
		}
	}

	private recoverLegacyIdentity(path: string, block: VariantBlock): void {
		const note = this.getNote(path);
		if (!note || note.blocks[block.identityKey]) return;
		const legacyKey = block.legacyIdentityKeys.find((key) => note.blocks[key]);
		if (!legacyKey) return;
		this.rekeyBlockStateInternal(path, legacyKey, block.identityKey);
		this.changed({ scope: 'block', path, blockKey: block.identityKey });
	}

	private rekeyBlockStateInternal(
		path: string,
		oldKey: string,
		newKey: string,
	): void {
		if (oldKey === newKey) return;
		const note = this.getNote(path);
		const oldState = note?.blocks[oldKey];
		if (note && oldState) {
			note.blocks[newKey] = { ...oldState, ...note.blocks[newKey] };
			delete note.blocks[oldKey];
		}
		moveMapValue(this.sessionHidden, sessionKey(path, oldKey), sessionKey(path, newKey));
		moveMapValue(
			this.editingVariants,
			sessionKey(path, oldKey),
			sessionKey(path, newKey),
		);
	}

	updateSettings(settings: SectionVariantsSettings): void {
		this.settings = settings;
		this.data.settings = settings;
		this.changed({ scope: 'settings' });
	}

	async flush(): Promise<void> {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		this.data.settings = this.settings;
		await this.plugin.saveData(this.data);
	}

	private changed(change: StoreChange): void {
		this.emit(change);
		if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = undefined;
			void this.flush();
		}, 250);
	}

	private emit(change: StoreChange): void {
		for (const listener of this.listeners) listener(change);
	}

	private removeRetiredDevicePreferences(): void {
		try {
			window.localStorage.removeItem(
				`section-variants:device:${this.data.vaultToken}`,
			);
		} catch {
			// Storage can be unavailable in restricted webviews; the retired value
			// is harmless because no runtime code reads it anymore.
		}
	}

}

interface MigrationResult {
	data: StoredData;
	warning?: string;
}

/**
 * Data written by a newer version of the plugin is kept verbatim under
 * `backup` rather than discarded, and the user is told. Previously any
 * unrecognised `version` silently wiped every saved selection.
 */
export function migrateData(loaded: unknown): MigrationResult {
	const created = createStoredData();
	if (!isRecord(loaded)) return { data: created };

	if (loaded.version !== 1 && loaded.version !== 2 && loaded.version !== 3) {
		return {
			data: { ...created, backup: loaded },
			warning:
				'Section Variants found saved data from a newer version. It has been kept but not loaded, and blocks are using their authored defaults.',
		};
	}

	return {
		data: {
			version: 3,
			vaultToken:
				typeof loaded.vaultToken === 'string'
					? loaded.vaultToken
					: created.vaultToken,
			settings: migrateSettings(loaded.settings),
			notes: migrateNotes(loaded.notes),
			...(loaded.backup === undefined ? {} : { backup: loaded.backup }),
		},
	};
}

function createStoredData(): StoredData {
	return {
		version: 3,
		vaultToken: randomToken(),
		settings: { ...DEFAULT_SETTINGS },
		notes: {},
	};
}

function migrateSettings(value: unknown): SectionVariantsSettings {
	if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
	return {
		defaultView: migrateViewMode(value.defaultView) ?? DEFAULT_SETTINGS.defaultView,
		defaultMinWidth:
			typeof value.defaultMinWidth === 'string'
				? value.defaultMinWidth
				: DEFAULT_SETTINGS.defaultMinWidth,
		stickyControlEnabled:
			typeof value.stickyControlEnabled === 'boolean'
				? value.stickyControlEnabled
				: DEFAULT_SETTINGS.stickyControlEnabled,
		automaticBlockIds:
			typeof value.automaticBlockIds === 'boolean'
				? value.automaticBlockIds
				: DEFAULT_SETTINGS.automaticBlockIds,
		aliases: Array.isArray(value.aliases)
			? value.aliases.filter((alias): alias is string => typeof alias === 'string')
			: [...DEFAULT_SETTINGS.aliases],
		exportState:
			value.exportState === 'current' || value.exportState === 'authored'
				? value.exportState
				: DEFAULT_SETTINGS.exportState,
		showIndicators:
			typeof value.showIndicators === 'boolean'
				? value.showIndicators
				: DEFAULT_SETTINGS.showIndicators,
	};
}

function migrateNotes(value: unknown): Record<string, PersistedNoteState> {
	if (!isRecord(value)) return {};
	const notes: Record<string, PersistedNoteState> = {};
	for (const [path, rawNote] of Object.entries(value)) {
		if (!isRecord(rawNote)) continue;
		const note = createNoteState();
		if (typeof rawNote.globalLabel === 'string') {
			note.globalLabel = rawNote.globalLabel;
		}
		const globalView = migrateViewMode(rawNote.globalView);
		if (globalView) note.globalView = globalView;
		if (typeof rawNote.stickyVisible === 'boolean') {
			note.stickyVisible = rawNote.stickyVisible;
		}
		if (isRecord(rawNote.blocks)) {
			for (const [identity, rawBlock] of Object.entries(rawNote.blocks)) {
				if (!isRecord(rawBlock)) continue;
				const block = ensureBlockState(note, identity);
				if (typeof rawBlock.selectedLabel === 'string') {
					block.selectedLabel = rawBlock.selectedLabel;
				}
				const view = migrateViewMode(rawBlock.view);
				if (view) block.view = view;
				if (rawBlock.labelMode === 'authored') block.labelMode = 'authored';
				if (rawBlock.viewMode === 'authored') block.viewMode = 'authored';
				if (
					rawBlock.globalMode === 'local' ||
					typeof rawBlock.selectedLabel === 'string' ||
					view !== undefined ||
					rawBlock.labelMode === 'authored' ||
					rawBlock.viewMode === 'authored'
				) {
					block.globalMode = 'local';
				}
				if (Array.isArray(rawBlock.savedHiddenLabels)) {
					const labels = rawBlock.savedHiddenLabels.filter(
						(label): label is string => typeof label === 'string',
					);
					if (labels.length > 0) block.savedHiddenLabels = labels;
				}
				pruneBlockState(note, identity);
			}
		}
		notes[path] = note;
	}
	return notes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isViewMode(value: unknown): value is ViewMode {
	return value === 'toggle' || value === 'columns';
}

function migrateViewMode(value: unknown): ViewMode | undefined {
	return value === 'auto' ? 'columns' : isViewMode(value) ? value : undefined;
}

function randomToken(): string {
	return [...randomBytes(8)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function sessionKey(path: string, identityKey: string): string {
	return `${path}\u0000${identityKey}`;
}

function replaceNormalizedLabel(
	labels: readonly string[],
	oldLabel: string,
	newLabel: string,
): string[] {
	return [...new Set(labels.map((label) =>
		normalizeLabel(label) === oldLabel ? newLabel : normalizeLabel(label),
	))];
}

function moveMapValue<T>(map: Map<string, T>, oldKey: string, newKey: string): void {
	if (oldKey === newKey || !map.has(oldKey)) return;
	const value = map.get(oldKey) as T;
	map.delete(oldKey);
	if (!map.has(newKey)) map.set(newKey, value);
}
