import { MarkdownView, Menu, Notice, setIcon } from 'obsidian';
import { normalizeLabel, ViewMode } from '../core/types';
import { unionLabels } from '../core/labels';
import { SectionVariantsHost } from '../plugin-host';
import { createSegmentedControl, VIEW_MODE_SEGMENTS } from './segmented-control';

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
		if (currentLabels.size > 1) {
			control.createSpan({
				cls: 'section-variants-mixed',
				text: 'Mixed',
				attr: { 'aria-label': 'Blocks currently show different variants' },
			});
		}

		const labels = unionLabels(blocks);
		const activeLabel =
			currentLabels.size === 1
				? labels.find((label) => currentLabels.has(normalizeLabel(label)))
				: undefined;
		createSegmentedControl(control, {
			cls: 'section-variants-labels',
			ariaLabel: 'Apply variant across note',
			emphasized: true,
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

		const views = new Set(
			blocks.map((block) => this.host.store.resolve(path, block).view),
		);
		// Undefined when blocks disagree, which leaves every segment unselected.
		const activeView: ViewMode | undefined =
			views.size === 1 ? [...views][0] : undefined;
		createSegmentedControl(control, {
			cls: 'section-variants-view-segments',
			ariaLabel: 'Apply view across note',
			value: activeView,
			options: VIEW_MODE_SEGMENTS,
			onSelect: (next) => {
				this.host.store.applyViewAcrossNote(path, parsed, next);
			},
		});

		const menuButton = control.createEl('button', {
			type: 'button',
			cls: 'clickable-icon',
			attr: { 'aria-label': 'Open note variants menu' },
		});
		setIcon(menuButton, 'more-horizontal');
		menuButton.addEventListener('click', (event) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item.setTitle('Collapse inactive content').setIcon('panel-top-close').onClick(() => {
					this.host.store.setNoteInactiveBehavior(path, 'collapsed');
				}),
			);
			menu.addItem((item) =>
				item.setTitle('Hide inactive content').setIcon('eye-off').onClick(() => {
					this.host.store.setNoteInactiveBehavior(path, 'hidden');
				}),
			);
			menu.addItem((item) =>
				item.setTitle('Use vault inactive-content setting').setIcon('undo-2').onClick(() => {
					this.host.store.setNoteInactiveBehavior(path, undefined);
				}),
			);
			menu.showAtMouseEvent(event);
		});

		const close = control.createEl('button', {
			type: 'button',
			cls: 'clickable-icon',
			attr: { 'aria-label': 'Hide sticky note control' },
		});
		setIcon(close, 'x');
		close.addEventListener('click', () =>
			this.host.store.setStickyVisible(path, false),
		);
	}
}
