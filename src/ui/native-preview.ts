import { App, Component, EventRef, MarkdownRenderer, Notice, TFile } from 'obsidian';

/** The undocumented surface shared by Obsidian's Reading View and previews. */
interface PreviewEngine {
	previewEl: HTMLElement;
	sizerEl: HTMLElement;
	queued: { cancel(): void } | null;
	set(markdown: string): void;
	rerender(full?: boolean): void;
	onResize(): void;
	queueRender(): void;
	addFooter(): void;
}

interface NativePreview extends Component {
	renderer: PreviewEngine;
	file: TFile | null;
	edit(markdown: string): void;
}

type PreviewConstructor = new (app: App, container: HTMLElement, observeInsertion: boolean) => NativePreview;

interface PreviewConfig {
	getConfig(key: string): unknown;
	on(name: 'config-changed', callback: (key: string) => void): EventRef;
}

export interface PreviewEdit {
	/** Compare-and-replace against the current note, never a captured offset. */
	(before: string, after: string): Promise<void> | void;
}

/**
 * Keep host internals here. Static MarkdownRenderer.render doesn't run the
 * Reading View section pipeline (list bullets, section wrappers, etc.).
 * Its instance does; no workspace leaf or cloned document is needed.
 */
export async function renderNativePreview(
	app: App,
	markdown: string,
	parent: HTMLElement,
	path: string,
	component: Component,
	write: PreviewEdit,
): Promise<void> {
	if (!markdown.trim()) return;
	// This is the same HTML boundary Obsidian uses inside Live Preview. Without
	// it, CodeMirror's break-spaces turns renderer newlines into visible lines.
	const mount = parent.createDiv({ cls: 'section-variants-preview cm-html-embed' });
	const Native = MarkdownRenderer as unknown as PreviewConstructor;
	const prototype = Native.prototype as object | undefined;
	if (!prototype || !('postProcess' in prototype)) {
		await fallback();
		return;
	}
	let disposed = false;
	let pending = false;
	let native: NativePreview | undefined;
	class FragmentPreview extends Native {
		get file(): TFile | null { return app.vault.getFileByPath(path); }
		edit(next: string): void {
			if (disposed || pending || next === markdown) return;
			pending = true;
			// Do not destroy the renderer in the middle of its checkbox handler.
			void Promise.resolve().then(async () => {
				if (disposed) return;
				await write(markdown, next);
				markdown = next;
				if (!disposed) this.renderer.set(next);
			}).catch((error: unknown) => {
				console.error('Section Variants: preview edit rejected', error);
				new Notice('This variant changed. Try the action again.');
				if (!disposed) this.renderer.rerender(true);
			}).finally(() => { pending = false; });
		}
	}
	try {
		native = new FragmentPreview(app, mount, false);
		const engine = native.renderer;
		if (!engine?.previewEl || !engine.sizerEl || typeof engine.set !== 'function' ||
			typeof engine.onResize !== 'function' || typeof engine.rerender !== 'function' || typeof engine.addFooter !== 'function') {
			throw new Error('Unsupported Obsidian preview interface.');
		}
		component.addChild(native);
		// Keep the native terminal section: Reading View's last-child margin
		// rules must not mistake the final authored paragraph for its footer.
		engine.addFooter();
		const config = app.vault as unknown as PreviewConfig;
		const refresh = (): void => {
			if (disposed) return;
			// Match Reading View configuration, never copy computed typography.
			for (const [name, key] of [['show-indentation-guide', 'showIndentGuide'], ['rtl', 'rightToLeft'], ['allow-fold-headings', 'foldHeading'], ['allow-fold-lists', 'foldIndent']]) {
				engine.previewEl.toggleClass(name!, Boolean(config.getConfig(key!)));
			}
			engine.onResize();
		};
		native.registerEvent(app.workspace.on('css-change', refresh));
		native.registerEvent(config.on('config-changed', key => {
			queueMicrotask(() => {
				if (disposed) return;
				refresh();
				if (key === 'strictLineBreaks') engine.rerender(true);
			});
		}));
		const observer = new ResizeObserver(refresh);
		observer.observe(mount);
		native.register(() => {
			disposed = true;
			observer.disconnect();
			engine.queued?.cancel();
			engine.queued = null;
			// An asynchronous host parse may finish after removal. It must not
			// enqueue more rendering into an unloaded component.
			engine.queueRender = () => {};
			mount.remove();
		});
		engine.set(markdown);
		refresh();
	} catch (error) {
		if (native) component.removeChild(native);
		mount.empty();
		parent.appendChild(mount);
		console.warn('Section Variants: using read-only preview fallback', error);
		await fallback();
	}

	async function fallback(): Promise<void> {
		// Supported static API remains readable on incompatible hosts. No edits
		// are inferred from this renderer's incomplete source-location metadata.
		mount.addClass('markdown-rendered');
		await MarkdownRenderer.render(app, markdown, mount, path, component);
		for (const checkbox of Array.from(mount.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) checkbox.disabled = true;
	}
}
