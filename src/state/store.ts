import { Notice, Plugin } from 'obsidian';
import {
	applyGlobalLabel,
	applyGlobalView,
	createNoteState,
	DEFAULT_SETTINGS,
	ensureBlockState,
	PersistedNoteState,
	pruneBlockState,
	ResolvedBlockState,
	resolveBlockState,
	SectionVariantsSettings,
} from '../core/state-model';
import { randomBytes } from '../core/random';
import {
	InactiveBehavior,
	normalizeLabel,
	ParsedNote,
	VariantBlock,
	ViewMode,
} from '../core/types';

interface StoredData {
	version: 1;
	vaultToken: string;
	settings: SectionVariantsSettings;
	notes: Record<string, PersistedNoteState>;
	/** Unrecognised data preserved verbatim so an upgrade never loses state. */
	backup?: unknown;
}

interface DevicePreferences {
	livePreviewInactive?: InactiveBehavior;
}

type Listener = (path?: string) => void;

export class StateStore {
	settings: SectionVariantsSettings = { ...DEFAULT_SETTINGS };
	private data: StoredData = createStoredData();
	private readonly listeners = new Set<Listener>();
	private readonly sessionHidden = new Map<string, Set<string>>();
	private readonly editingVariants = new Map<string, string>();
	private saveTimer?: number;

	constructor(private readonly plugin: Plugin) {}

	async load(): Promise<void> {
		const loaded = (await this.plugin.loadData()) as Partial<StoredData> | null;
		const migration = migrateData(loaded);
		this.data = migration.data;
		if (migration.warning) new Notice(migration.warning, 10000);
		this.settings = this.data.settings;
		const device = this.loadDevicePreferences();
		if (device.livePreviewInactive) {
			this.settings = {
				...this.settings,
				livePreviewInactive: device.livePreviewInactive,
			};
		}
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
		return resolveBlockState(
			block,
			this.getNote(path),
			this.settings,
			this.sessionHidden.get(sessionKey(path, block.identityKey)),
		);
	}

	setSelectedLabel(path: string, block: VariantBlock, label: string): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		ensureBlockState(note, block.identityKey).selectedLabel = label;
		this.changed(path);
	}

	followGlobalLabel(path: string, block: VariantBlock): boolean {
		const note = this.getNote(path);
		if (!note?.globalLabel) return false;
		const compatible = block.variants.some(
			(variant) =>
				variant.normalizedLabel === normalizeLabel(note.globalLabel ?? ''),
		);
		if (!compatible) return false;
		const state = note.blocks[block.identityKey];
		if (state) {
			delete state.selectedLabel;
			pruneBlockState(note, block.identityKey);
		}
		this.changed(path);
		return true;
	}

	setView(path: string, block: VariantBlock, view: ViewMode): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		ensureBlockState(note, block.identityKey).view = view;
		this.changed(path);
	}

	applyLabelAcrossNote(
		path: string,
		parsed: ParsedNote,
		label: string,
	): { applied: number; skipped: number } {
		const note = this.getNote(path, true) as PersistedNoteState;
		const result = applyGlobalLabel(note, parsed, this.settings, label);
		this.changed(path);
		return result;
	}

	applyViewAcrossNote(path: string, parsed: ParsedNote, view: ViewMode): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		applyGlobalView(note, parsed, view);
		this.changed(path);
	}

	toggleHidden(path: string, block: VariantBlock, label: string): void {
		const key = sessionKey(path, block.identityKey);
		const persisted = this.getNote(path)?.blocks[block.identityKey];
		const hidden =
			this.sessionHidden.get(key) ??
			new Set((persisted?.savedHiddenLabels ?? []).map(normalizeLabel));
		const normalized = normalizeLabel(label);
		if (hidden.has(normalized)) hidden.delete(normalized);
		else hidden.add(normalized);
		this.sessionHidden.set(key, hidden);
		this.emit(path);
	}

	saveHidden(path: string, block: VariantBlock): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		const hidden = this.sessionHidden.get(sessionKey(path, block.identityKey));
		const state = ensureBlockState(note, block.identityKey);
		state.savedHiddenLabels = hidden && hidden.size > 0 ? [...hidden] : undefined;
		pruneBlockState(note, block.identityKey);
		this.changed(path);
	}

	setToolbarPinned(path: string, block: VariantBlock, pinned: boolean): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		const state = ensureBlockState(note, block.identityKey);
		state.toolbarPinned = pinned || undefined;
		pruneBlockState(note, block.identityKey);
		this.changed(path);
	}

	setBlockInactiveBehavior(
		path: string,
		block: VariantBlock,
		behavior: InactiveBehavior | undefined,
	): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		const state = ensureBlockState(note, block.identityKey);
		state.inactiveBehavior = behavior;
		pruneBlockState(note, block.identityKey);
		this.changed(path);
	}

	setStickyVisible(path: string, visible: boolean): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		note.stickyVisible = visible;
		this.changed(path);
	}

	setNoteInactiveBehavior(
		path: string,
		behavior: InactiveBehavior | undefined,
	): void {
		const note = this.getNote(path, true) as PersistedNoteState;
		note.inactiveBehavior = behavior;
		this.changed(path);
	}

	isStickyVisible(path: string): boolean {
		return this.getNote(path)?.stickyVisible ?? this.settings.stickyControlEnabled;
	}

	setEditingVariant(path: string, block: VariantBlock, label?: string): void {
		const key = sessionKey(path, block.identityKey);
		if (label) this.editingVariants.set(key, label);
		else this.editingVariants.delete(key);
		this.emit(path);
	}

	getEditingVariant(path: string, block: VariantBlock): string | undefined {
		return this.editingVariants.get(sessionKey(path, block.identityKey));
	}

	resetBlock(path: string, block: VariantBlock): void {
		const note = this.getNote(path);
		if (note) delete note.blocks[block.identityKey];
		this.sessionHidden.delete(sessionKey(path, block.identityKey));
		this.editingVariants.delete(sessionKey(path, block.identityKey));
		this.changed(path);
	}

	resetNote(path: string): void {
		delete this.data.notes[path];
		for (const key of [...this.sessionHidden.keys()]) {
			if (key.startsWith(`${path}\u0000`)) this.sessionHidden.delete(key);
		}
		for (const key of [...this.editingVariants.keys()]) {
			if (key.startsWith(`${path}\u0000`)) this.editingVariants.delete(key);
		}
		this.changed(path);
	}

	renameNote(oldPath: string, newPath: string): void {
		const note = this.data.notes[oldPath];
		if (!note) return;
		this.data.notes[newPath] = note;
		delete this.data.notes[oldPath];
		this.moveSessionKeys(oldPath, newPath);
		this.changed(newPath);
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
		this.changed();
	}

	deleteNote(path: string): void {
		if (!this.data.notes[path]) return;
		delete this.data.notes[path];
		this.clearSessionKeys(path);
		this.changed();
	}

	/** Drop state for every note inside a deleted folder. */
	deleteFolder(path: string): void {
		const prefix = `${path}/`;
		for (const notePath of Object.keys(this.data.notes)) {
			if (!notePath.startsWith(prefix)) continue;
			delete this.data.notes[notePath];
			this.clearSessionKeys(notePath);
		}
		this.changed();
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
		if (removed > 0) this.changed();
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

	updateSettings(settings: SectionVariantsSettings): void {
		this.settings = settings;
		this.data.settings = settings;
		this.saveDevicePreferences({
			livePreviewInactive: settings.livePreviewInactive,
		});
		this.changed();
	}

	async flush(): Promise<void> {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		this.data.settings = this.settings;
		await this.plugin.saveData(this.data);
	}

	private changed(path?: string): void {
		this.emit(path);
		if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = undefined;
			void this.flush();
		}, 250);
	}

	private emit(path?: string): void {
		for (const listener of this.listeners) listener(path);
	}

	private loadDevicePreferences(): DevicePreferences {
		try {
			const raw = window.localStorage.getItem(this.deviceStorageKey());
			return raw ? (JSON.parse(raw) as DevicePreferences) : {};
		} catch {
			return {};
		}
	}

	private saveDevicePreferences(preferences: DevicePreferences): void {
		try {
			window.localStorage.setItem(
				this.deviceStorageKey(),
				JSON.stringify(preferences),
			);
		} catch {
			// Device-local preferences are optional; data.json remains authoritative.
		}
	}

	private deviceStorageKey(): string {
		return `section-variants:device:${this.data.vaultToken}`;
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
function migrateData(loaded: Partial<StoredData> | null): MigrationResult {
	const created = createStoredData();
	if (!loaded) return { data: created };

	if (loaded.version !== 1) {
		return {
			data: { ...created, backup: loaded },
			warning:
				'Section Variants found saved data from a newer version. It has been kept but not loaded, and blocks are using their authored defaults.',
		};
	}

	return {
		data: {
			version: 1,
			vaultToken: loaded.vaultToken ?? created.vaultToken,
			settings: { ...DEFAULT_SETTINGS, ...loaded.settings },
			notes: loaded.notes ?? {},
			...(loaded.backup === undefined ? {} : { backup: loaded.backup }),
		},
	};
}

function createStoredData(): StoredData {
	return {
		version: 1,
		vaultToken: randomToken(),
		settings: { ...DEFAULT_SETTINGS },
		notes: {},
	};
}

function randomToken(): string {
	return [...randomBytes(8)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function sessionKey(path: string, identityKey: string): string {
	return `${path}\u0000${identityKey}`;
}
