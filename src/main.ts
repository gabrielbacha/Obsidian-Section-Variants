import {
	Editor,
	EditorPosition,
	MarkdownView,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
} from 'obsidian';
import { registerCommands } from './commands';
import {
	addVariant,
	addStableBlockId,
	deleteVariant,
	fixMissingClosers,
	renameVariant,
	updateBlockAttributesPatch,
} from './core/mutations';
import { collectLabelCatalog } from './core/labels';
import { resolveCurrentBlock } from './core/block-resolution';
import { parseNote } from './core/parser';
import { serializeVariantsBlock } from './core/serializer';
import {
	ContainerAttributes,
	ParsedNote,
	ResponsiveMode,
	VariantBlock,
	ViewMode,
} from './core/types';
import {
	createLivePreviewExtension,
	refreshLivePreviewEditors,
} from './editor/live-preview';
import { VariantsEditorSuggest } from './editor/suggest';
import { chooseMutationEditor } from './editor/mutation-target';
import { HtmlExportModal } from './export/html-export';
import { SectionVariantsHost } from './plugin-host';
import { ReadingViewCoordinator } from './reading/coordinator';
import { SectionVariantsSettingTab } from './settings';
import { StateStore, StoreChange } from './state/store';
import {
	AddVariantModal,
	ColumnRatiosModal,
	DeleteVariantConfirmationModal,
	InsertVariantsModal,
	RenameVariantModal,
} from './ui/modals';
import { StickyControlManager } from './ui/sticky-control';
import { errorMessage } from './core/errors';

/** Enough to cover the open panes without holding many note bodies in memory. */
const PARSE_CACHE_LIMIT = 8;

export default class SectionVariantsPlugin
	extends Plugin
	implements SectionVariantsHost
{
	store!: StateStore;
	private readingCoordinator!: ReadingViewCoordinator;
	private stickyControls!: StickyControlManager;
	/*
	 * Parse results keyed by source text. Content-keyed rather than path-keyed
	 * so panes showing the same note share an entry, and so a keystroke simply
	 * misses rather than needing explicit invalidation. A single-entry memo
	 * thrashed once more than one note was open.
	 */
	private readonly parseCache = new Map<string, ParsedNote>();
	private lastAliasesKey?: string;
	private stickyRefreshTimer?: number;
	private stickyRefreshPath?: string;
	private stickyRefreshAll = false;

	async onload(): Promise<void> {
		this.store = new StateStore(this);
		await this.store.load();
		this.readingCoordinator = new ReadingViewCoordinator(this);
		this.stickyControls = new StickyControlManager(this);

		this.registerMarkdownPostProcessor((el, context) =>
			this.readingCoordinator.postProcess(el, context),
		);
		this.registerEditorExtension(createLivePreviewExtension(this));
		this.registerEditorSuggest(
			new VariantsEditorSuggest(this, (editor, position) =>
				this.openInsertModal(editor, position),
			),
		);
		registerCommands(this);
		this.addSettingTab(new SectionVariantsSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on('file-open', () => this.scheduleViewRefresh()),
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () =>
				this.scheduleViewRefresh(),
			),
		);
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.scheduleViewRefresh()),
		);
		this.registerEvent(
			// The parse cache is keyed by source text, so edited content misses
			// naturally and needs no explicit invalidation here.
			this.app.workspace.on('editor-change', (_editor, info) => {
				this.scheduleStickyRefresh(info.file?.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				this.handleRename(file, oldPath);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => this.handleDelete(file)),
		);
		this.register(
			this.store.subscribe((change) => this.handleStoreChange(change)),
		);
		this.app.workspace.onLayoutReady(() => {
			this.pruneMissingNotes();
			this.refreshAllViews();
		});
	}

	onunload(): void {
		if (this.stickyRefreshTimer !== undefined) {
			window.clearTimeout(this.stickyRefreshTimer);
			this.stickyRefreshTimer = undefined;
		}
		this.stickyControls?.destroy();
		void this.store?.flush();
	}

	parse(source: string): ParsedNote {
		const aliasesKey = this.store.settings.aliases.join('\u0000');
		if (this.lastAliasesKey !== aliasesKey) {
			// Aliases decide which container names parse at all, so every
			// existing entry is stale.
			this.parseCache.clear();
			this.lastAliasesKey = aliasesKey;
		}
		const cached = this.parseCache.get(source);
		if (cached) {
			// Re-insert to refresh recency for the eviction below.
			this.parseCache.delete(source);
			this.parseCache.set(source, cached);
			return cached;
		}
		const parsed = parseNote(source, this.store.settings.aliases);
		this.parseCache.set(source, parsed);
		while (this.parseCache.size > PARSE_CACHE_LIMIT) {
			const oldest = this.parseCache.keys().next().value;
			if (oldest === undefined) break;
			this.parseCache.delete(oldest);
		}
		return parsed;
	}

	refreshAllViews(path?: string): void {
		refreshLivePreviewEditors(path);
		this.stickyControls?.refresh(path);
	}

	openInsertModal(editor: Editor, position: EditorPosition): void {
		new InsertVariantsModal(
			this.app,
			collectLabelCatalog(this.parse(editor.getValue()).blocks),
			(options) => {
				try {
					const serialized = serializeVariantsBlock(options);
					editor.replaceRange(serialized.markdown, position);
					const insertionOffset =
						editor.posToOffset(position) + serialized.firstContentOffset;
					editor.setCursor(editor.offsetToPos(insertionOffset));
				} catch (error) {
					new Notice(errorMessage(error));
				}
			},
		).open();
	}

	setBlockName(
		path: string,
		block: VariantBlock,
		name: string,
		origin?: HTMLElement,
	): void {
		this.queueBlockAttributesPatch(
			path,
			block,
			{ name: name.trim() || undefined },
			origin,
		);
	}

	setBlockDefaultLabel(
		path: string,
		block: VariantBlock,
		label: string,
		origin?: HTMLElement,
	): void {
		this.queueBlockAttributesPatch(path, block, { defaultLabel: label }, origin);
	}

	setBlockAuthoredView(
		path: string,
		block: VariantBlock,
		view: ViewMode,
		origin?: HTMLElement,
	): void {
		this.queueBlockAttributesPatch(path, block, { view }, origin);
	}

	openColumnRatios(
		path: string,
		block: VariantBlock,
		origin?: HTMLElement,
	): void {
		new ColumnRatiosModal(this.app, block, async (widths) => {
			await this.applyBlockAttributesPatch(path, block, { widths }, origin);
		}).open();
	}

	setBlockResponsive(
		path: string,
		block: VariantBlock,
		responsive: ResponsiveMode,
		origin?: HTMLElement,
	): void {
		this.queueBlockAttributesPatch(
			path,
			block,
			{ responsive: responsive === 'responsive' ? undefined : responsive },
			origin,
		);
	}

	private queueBlockAttributesPatch(
		path: string,
		block: VariantBlock,
		patch: Partial<ContainerAttributes>,
		origin?: HTMLElement,
	): void {
		void this.applyBlockAttributesPatch(path, block, patch, origin).catch(
			(error) => new Notice(errorMessage(error)),
		);
	}

	private async applyBlockAttributesPatch(
		path: string,
		block: VariantBlock,
		patch: Partial<ContainerAttributes>,
		origin?: HTMLElement,
	): Promise<void> {
		const mapping = await updateBlockAttributesPatch(
			this.app,
			path,
			block,
			patch,
			(source) => this.parseFresh(source),
			this.resolveEditor(path, origin),
		);
		this.store.rekeyBlockState(path, mapping.before, mapping.after);
		this.refreshAfterSourceMutation(path, mapping.source);
		// Obsidian may publish its editor-change event after the structural
		// transaction returns. Re-dispatch once on the next turn so decorations
		// cannot retain a widget built from the pre-mutation document.
		this.scheduleViewRefresh(path);
		await this.store.flush();
	}

	openAddVariant(path: string, block: VariantBlock, origin?: HTMLElement): void {
		void this.openCurrentAddVariantModal(path, block, origin);
	}

	private async openCurrentAddVariantModal(
		path: string,
		block: VariantBlock,
		origin?: HTMLElement,
	): Promise<void> {
		try {
			const initialEditor = this.resolveEditor(path, origin);
			const file = this.app.vault.getAbstractFileByPath(path);
			const source =
				initialEditor?.getValue() ??
				(file instanceof TFile
					? await this.app.vault.cachedRead(file)
					: undefined);
			if (source === undefined) throw new Error(`Note not found: ${path}`);
			const parsed = this.parseFresh(source);
			const current = resolveCurrentBlock(block, parsed.blocks);
			if (!current?.valid) {
				throw new Error('The variants block changed. Try the action again.');
			}
			const suggestions = collectLabelCatalog(parsed.blocks);
			new AddVariantModal(this.app, current, suggestions, async (label) => {
				const result = await addVariant(
					this.app,
					path,
					current,
					label,
					(source) => this.parseFresh(source),
					this.resolveEditor(path, origin),
				);
				this.store.rekeyBlockState(path, result.before, result.after);
				this.refreshAfterSourceMutation(path, result.source);
				await this.store.flush();
				new Notice(`Added ${result.label}.`);
			}).open();
		} catch (error) {
			new Notice(errorMessage(error));
		}
	}

	openDeleteVariant(
		path: string,
		block: VariantBlock,
		label: string,
		origin?: HTMLElement,
	): void {
		new DeleteVariantConfirmationModal(this.app, label, async () => {
			const result = await deleteVariant(
				this.app,
				path,
				block,
				label,
				(source) => this.parseFresh(source),
				this.resolveEditor(path, origin),
			);
			this.store.migrateDeletedVariant(
				path,
				result.before,
				result.after,
				result.label,
			);
			this.refreshAfterSourceMutation(path, result.source);
			await this.store.flush();
			new Notice(`Deleted ${result.label}.`);
		}).open();
	}

	openRenameVariant(
		path: string,
		block: VariantBlock,
		label: string,
		origin?: HTMLElement,
	): void {
		new RenameVariantModal(
			this.app,
			label,
			async (oldLabel, newLabel, acrossNote) => {
				const result = await renameVariant(
					this.app,
					path,
					block,
					oldLabel,
					newLabel,
					acrossNote,
					(source) => this.parseFresh(source),
					this.resolveEditor(path, origin),
				);
				this.store.migrateRenamedLabels(
					path,
					result.mappings,
					result.oldLabel,
					result.newLabel,
					result.acrossNote,
				);
				this.refreshAfterSourceMutation(path, result.source);
				await this.store.flush();
			},
		).open();
	}

	async ensurePersistentIdentity(
		path: string,
		block: VariantBlock,
	): Promise<VariantBlock | undefined> {
		if (!block.identityAmbiguous || !this.store.settings.automaticBlockIds) {
			return block;
		}
		try {
			const result = await addStableBlockId(
				this.app,
				path,
				block,
				(source) => this.parseFresh(source),
				this.resolveEditor(path),
			);
			this.store.rekeyBlockState(path, result.before, result.after);
			this.refreshAfterSourceMutation(path, result.source);
			await this.store.flush();
			return result.after;
		} catch (error) {
			new Notice(errorMessage(error));
			return undefined;
		}
	}

	async addStableBlockId(path: string, block: VariantBlock): Promise<void> {
		try {
			const result = await addStableBlockId(
				this.app,
				path,
				block,
				(source) => this.parseFresh(source),
				this.resolveEditor(path),
			);
			this.store.rekeyBlockState(path, result.before, result.after);
			this.refreshAfterSourceMutation(path, result.source);
			await this.store.flush();
			new Notice(`Added block ID ^${result.id}.`);
		} catch (error) {
			new Notice(errorMessage(error));
		}
	}

	async fixBlock(path: string, block: VariantBlock): Promise<void> {
		try {
			const result = await fixMissingClosers(
				this.app,
				path,
				block,
				(source) => this.parseFresh(source),
				this.resolveEditor(path),
			);
			this.refreshAfterSourceMutation(path, result.source);
			new Notice('Added the missing closing fence.');
		} catch (error) {
			new Notice(errorMessage(error));
		}
	}

	openHtmlExport(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) {
			new Notice('Open a Markdown note before exporting.');
			return;
		}
		new HtmlExportModal(this, view.file).open();
	}

	private parseFresh(source: string): ParsedNote {
		return parseNote(source, this.store.settings.aliases);
	}

	private resolveEditor(path: string, origin?: HTMLElement): Editor | undefined {
		const views = this.app.workspace
			.getLeavesOfType('markdown')
			.map((leaf) => leaf.view)
			.filter(
				(view): view is MarkdownView =>
					view instanceof MarkdownView && view.file?.path === path,
			);
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		return chooseMutationEditor(
			views.map((view) => ({
				editor: view.editor,
				containsOrigin: origin ? view.containerEl.contains(origin) : false,
				sameDocument: origin
					? view.containerEl.ownerDocument === origin.ownerDocument
					: false,
				active: view === active,
			})),
		);
	}

	private refreshAfterSourceMutation(path: string, source: string): void {
		this.readingCoordinator.rebind(path, source);
		this.refreshAllViews(path);
	}

	private scheduleViewRefresh(path?: string): void {
		window.setTimeout(() => this.refreshAllViews(path), 0);
	}

	private scheduleStickyRefresh(path?: string): void {
		if (this.stickyRefreshTimer !== undefined) {
			if (this.stickyRefreshPath !== path) this.stickyRefreshAll = true;
			return;
		}
		this.stickyRefreshPath = path;
		this.stickyRefreshAll = false;
		this.stickyRefreshTimer = window.setTimeout(() => {
			this.stickyRefreshTimer = undefined;
			const refreshPath = this.stickyRefreshAll
				? undefined
				: this.stickyRefreshPath;
			this.stickyRefreshPath = undefined;
			this.stickyRefreshAll = false;
			this.stickyControls?.refresh(refreshPath);
		}, 50);
	}

	private handleStoreChange(change: StoreChange): void {
		refreshLivePreviewEditors(change.path);
		this.stickyControls?.refresh(change.path);
	}

	private handleDelete(file: TAbstractFile): void {
		if (file instanceof TFile) this.store.deleteNote(file.path);
		else if (file instanceof TFolder) this.store.deleteFolder(file.path);
	}

	private handleRename(file: TAbstractFile, oldPath: string): void {
		if (file instanceof TFile) this.store.renameNote(oldPath, file.path);
		else if (file instanceof TFolder) this.store.renameFolder(oldPath, file.path);
	}

	/**
	 * Drop state for notes deleted while the plugin was disabled, which the
	 * vault events above never had a chance to observe.
	 */
	private pruneMissingNotes(): void {
		const existing = new Set(
			this.app.vault.getMarkdownFiles().map((file) => file.path),
		);
		this.store.collectGarbage(existing);
	}
}
