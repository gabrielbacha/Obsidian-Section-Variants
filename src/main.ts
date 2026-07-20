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
	addStableBlockId,
	fixMissingClosers,
	renameVariant,
	updateBlockAttributes,
} from './core/mutations';
import { parseNote } from './core/parser';
import { serializeVariantsBlock } from './core/serializer';
import { ParsedNote, VariantBlock } from './core/types';
import {
	createLivePreviewExtension,
	refreshLivePreviewEditors,
} from './editor/live-preview';
import { VariantsEditorSuggest } from './editor/suggest';
import { HtmlExportModal } from './export/html-export';
import { SectionVariantsHost } from './plugin-host';
import { ReadingViewCoordinator } from './reading/coordinator';
import { SectionVariantsSettingTab } from './settings';
import { StateStore } from './state/store';
import {
	BlockConfigurationModal,
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
				this.scheduleViewRefresh(info.file?.path);
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
			this.store.subscribe((path) => this.refreshAllViews(path)),
		);
		this.app.workspace.onLayoutReady(() => {
			this.pruneMissingNotes();
			this.refreshAllViews();
		});
	}

	onunload(): void {
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
		new InsertVariantsModal(this.app, (options) => {
			try {
				const serialized = serializeVariantsBlock(options);
				editor.replaceRange(serialized.markdown, position);
				const insertionOffset =
					editor.posToOffset(position) + serialized.firstContentOffset;
				editor.setCursor(editor.offsetToPos(insertionOffset));
			} catch (error) {
				new Notice(errorMessage(error));
			}
		}).open();
	}

	openBlockConfiguration(path: string, block: VariantBlock): void {
		new BlockConfigurationModal(this.app, block, async (attributes) => {
			await updateBlockAttributes(
				this.app,
				path,
				block,
				attributes,
				(source) => this.parseFresh(source),
			);
		}).open();
	}

	openRenameVariant(path: string, block: VariantBlock): void {
		new RenameVariantModal(
			this.app,
			block,
			async (oldLabel, newLabel, acrossNote) => {
				await renameVariant(
					this.app,
					path,
					block,
					oldLabel,
					newLabel,
					acrossNote,
					(source) => this.parseFresh(source),
				);
			},
		).open();
	}

	async ensurePersistentIdentity(
		path: string,
		block: VariantBlock,
	): Promise<boolean> {
		if (!block.identityAmbiguous || !this.store.settings.automaticBlockIds) {
			return true;
		}
		try {
			const id = await addStableBlockId(this.app, path, block, (source) =>
				this.parseFresh(source),
			);
			/*
			 * Re-point the in-memory block at its new stable identity so the
			 * action the user actually clicked completes against the right key.
			 * Previously this returned false and asked them to click again.
			 */
			block.blockId = id;
			block.identityKey = `block:${id}`;
			block.identityAmbiguous = false;
			return true;
		} catch (error) {
			new Notice(errorMessage(error));
			return false;
		}
	}

	async addStableBlockId(path: string, block: VariantBlock): Promise<void> {
		try {
			const id = await addStableBlockId(
				this.app,
				path,
				block,
				(source) => this.parseFresh(source),
			);
			new Notice(`Added block ID ^${id}.`);
		} catch (error) {
			new Notice(errorMessage(error));
		}
	}

	async fixBlock(path: string, block: VariantBlock): Promise<void> {
		try {
			await fixMissingClosers(
				this.app,
				path,
				block,
				(source) => this.parseFresh(source),
			);
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

	private scheduleViewRefresh(path?: string): void {
		window.setTimeout(() => this.refreshAllViews(path), 0);
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

