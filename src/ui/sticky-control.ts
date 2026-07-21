import { MarkdownView, Menu, Notice } from 'obsidian';
import { normalizeLabel, ViewMode } from '../core/types';
import { unionLabels } from '../core/labels';
import { SectionVariantsHost } from '../plugin-host';
import { createSegmentedControl, VIEW_MODE_SEGMENTS } from './segmented-control';
import { createVariantMarker } from './variant-marker';

export class StickyControlManager {
	private readonly controls = new Map<MarkdownView, HTMLElement>();

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
		for (const [view, control] of this.controls) {
			if (activeViews.has(view)) continue;
			if (liveViews.has(view) && view.file) continue;
			control.remove();
			this.controls.delete(view);
		}
	}

	destroy(): void {
		for (const control of this.controls.values()) control.remove();
		this.controls.clear();
	}

	private renderForView(view: MarkdownView, path: string): void {
		const parsed = this.host.parse(view.editor.getValue());
		const blocks = parsed.blocks.filter((block) => block.valid);
		const visible =
			blocks.length >= 2 && this.host.store.isStickyVisible(path);
		let control = this.controls.get(view);
		if (!visible) {
			control?.remove();
			this.controls.delete(view);
			return;
		}
		if (!control) {
			control = view.containerEl.createDiv({ cls: 'section-variants-sticky-control' });
			this.controls.set(view, control);
		}
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
		createVariantMarker(control, {
			ariaLabel: 'Open note variants menu',
			tooltip: [
				activeLabel ? `Current variant: ${activeLabel}` : 'Current variant: Mixed',
				activeView ? `Current view: ${activeView}` : 'Current view: Mixed',
				differs
					? 'Some blocks differ from authored defaults'
					: 'All blocks follow authored defaults',
			].join('\n'),
			differs: differs && this.host.store.settings.showIndicators,
			mixed: currentLabels.size > 1 || views.size > 1,
			onClick: (event) => this.openMenu(event, path, parsed, activeView),
		});
		createSegmentedControl(control, {
			cls: 'section-variants-labels',
			ariaLabel: 'Apply variant across note',
			value: activeLabel,
			options: labels.map((label) => ({
				value: label,
				text: label,
				label,
			})),
			onSelect: (label) => {
				const result = this.host.store.applyLabelAcrossNote(path, parsed, label);
				new Notice(
					`Applied to ${result.applied} block${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}.`,
				);
			},
		});
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
