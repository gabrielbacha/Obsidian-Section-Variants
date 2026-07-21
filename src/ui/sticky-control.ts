import { MarkdownView, Menu, Notice } from 'obsidian';
import { normalizeLabel, ViewMode } from '../core/types';
import { unionLabels } from '../core/labels';
import { SectionVariantsHost } from '../plugin-host';
import { createSegmentedControl, VIEW_MODE_SEGMENTS } from './segmented-control';
import { bottomObstruction } from './sticky-layout';
import { createVariantMarker } from './variant-marker';

interface StickyControlResource {
	control: HTMLElement;
	observer: ResizeObserver;
	statusBar?: HTMLElement;
}

export class StickyControlManager {
	private readonly controls = new Map<MarkdownView, StickyControlResource>();

	constructor(private readonly host: SectionVariantsHost) {}

	refresh(path?: string): void {
		const activeViews = new Set<MarkdownView>();
		for (const leaf of this.host.app.workspace.getLeavesOfType('markdown')) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			const view = leaf.view;
			const viewPath = view.file?.path;
			if (!viewPath || (path && path !== viewPath)) continue;
			activeViews.add(view);
			this.renderForView(view, viewPath);
		}
		// Drop controls for views that are gone or no longer showing a file. This
		// must consider every tracked view regardless of `path`, otherwise a
		// path-scoped refresh — the common case — never reclaims closed views.
		const liveViews = new Set(
			this.host.app.workspace
				.getLeavesOfType('markdown')
				.map((leaf) => leaf.view)
				.filter((view): view is MarkdownView => view instanceof MarkdownView),
		);
		for (const [view, resource] of this.controls) {
			if (activeViews.has(view)) continue;
			if (liveViews.has(view) && view.file) continue;
			this.removeControl(view, resource);
		}
	}

	destroy(): void {
		for (const resource of this.controls.values()) {
			resource.observer.disconnect();
			resource.control.remove();
		}
		this.controls.clear();
	}

	private renderForView(view: MarkdownView, path: string): void {
		const parsed = this.host.parse(view.editor.getValue());
		const blocks = parsed.blocks.filter((block) => block.valid);
		const visible =
			blocks.length >= 2 && this.host.store.isStickyVisible(path);
		let resource = this.controls.get(view);
		if (!visible) {
			if (resource) this.removeControl(view, resource);
			return;
		}
		if (!resource) {
			resource = this.createControl(view);
			this.controls.set(view, resource);
		}
		this.observeLayout(view, resource);
		const { control } = resource;
		control.empty();
		control.setAttribute('role', 'toolbar');
		control.setAttribute('aria-label', 'Note-wide section variants');

		const currentLabels = new Set(
			blocks.map((block) =>
				normalizeLabel(this.host.store.resolve(path, block).selectedLabel),
			),
		);
		const labels = unionLabels(blocks);
		const activeLabel =
			currentLabels.size === 1
				? labels.find((label) => currentLabels.has(normalizeLabel(label)))
				: undefined;
		const views = new Set(
			blocks.map((block) => this.host.store.resolve(path, block).view),
		);
		const activeView: ViewMode | undefined =
			views.size === 1 ? [...views][0] : undefined;
		const differs = blocks.some(
			(block) => this.host.store.resolve(path, block).differsFromAuthored,
		);
		const reveal = control.createDiv({ cls: 'section-variants-reveal-controls' });
		createSegmentedControl(reveal, {
			cls: 'section-variants-labels',
			ariaLabel: 'Apply variant across note',
			value: activeLabel,
			options: labels.map((label) => ({ value: label, text: label, label })),
			onSelect: (label) => {
				const result = this.host.store.applyLabelAcrossNote(path, parsed, label);
				new Notice(
					`Applied to ${result.applied} block${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}.`,
				);
			},
		});
		createSegmentedControl(reveal, {
			cls: 'section-variants-view-modes',
			ariaLabel: 'Apply view across note',
			value: activeView,
			options: VIEW_MODE_SEGMENTS,
			onSelect: (viewMode) => {
				this.host.store.applyViewAcrossNote(path, parsed, viewMode);
			},
		});
		createVariantMarker(control, {
			ariaLabel: 'Open note variants menu',
			tooltip: `${activeLabel ?? 'Mixed'} · ${activeView ? titleCase(activeView) : 'Mixed'}${differs ? ' · differs from defaults' : ''}`,
			differs: differs && this.host.store.settings.showIndicators,
			mixed: currentLabels.size > 1 || views.size > 1,
			onClick: (event) => this.openMenu(event, path, parsed, activeView),
		});
	}

	private createControl(view: MarkdownView): StickyControlResource {
		const control = view.containerEl.createDiv({ cls: 'section-variants-sticky-control' });
		let resource: StickyControlResource;
		const observer = new ResizeObserver(() => {
			this.updateBottomOffset(view, resource);
		});
		resource = { control, observer };
		observer.observe(view.containerEl);
		return resource;
	}

	private observeLayout(
		view: MarkdownView,
		resource: StickyControlResource,
	): void {
		const statusBar = view.containerEl.ownerDocument.querySelector<HTMLElement>(
			'.status-bar',
		) ?? undefined;
		if (resource.statusBar !== statusBar) {
			resource.observer.disconnect();
			resource.observer.observe(view.containerEl);
			if (statusBar) resource.observer.observe(statusBar);
			resource.statusBar = statusBar;
		}
		this.updateBottomOffset(view, resource);
	}

	private updateBottomOffset(
		view: MarkdownView,
		resource: StickyControlResource,
	): void {
		const obstruction = bottomObstruction(
			view.containerEl.getBoundingClientRect(),
			resource.statusBar?.getBoundingClientRect(),
		);
		resource.control.style.setProperty(
			'--section-variants-bottom-obstruction',
			`${obstruction}px`,
		);
	}

	private removeControl(
		view: MarkdownView,
		resource: StickyControlResource,
	): void {
		resource.observer.disconnect();
		resource.control.remove();
		this.controls.delete(view);
	}

	private openMenu(
		event: MouseEvent,
		path: string,
		parsed: ReturnType<SectionVariantsHost['parse']>,
		activeView: ViewMode | undefined,
	): void {
		const menu = new Menu();
		for (const view of VIEW_MODE_SEGMENTS) {
			menu.addItem((item) =>
				item
					.setTitle(view.tooltip ?? view.label)
					.setIcon(view.icon ?? 'circle')
					.setChecked(activeView === view.value)
					.onClick(() => {
						this.host.store.applyViewAcrossNote(path, parsed, view.value);
					}),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle('Hide note control').setIcon('x').onClick(() => {
				this.host.store.setStickyVisible(path, false);
			}),
		);
		menu.showAtMouseEvent(event);
	}
}

function titleCase(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
