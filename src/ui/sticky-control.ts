import {
	MarkdownView,
	Menu,
	Notice,
	setIcon,
	setTooltip,
} from 'obsidian';
import { normalizeLabel, ResponsiveMode, ViewMode } from '../core/types';
import { unionLabels } from '../core/labels';
import { SectionVariantsHost } from '../plugin-host';
import { createSegmentedControl, VIEW_MODE_SEGMENTS } from './segmented-control';
import { bottomObstruction } from './sticky-layout';
import { createVariantMarker } from './variant-marker';
import { NARROW_LAYOUT_OPTIONS } from './block-menu-actions';

interface StickyControlResource {
	control: HTMLElement;
	observer: ResizeObserver;
	statusBar?: HTMLElement;
}

const SHOW_NOTE_CONTROL_COMMAND = 'Show note control';

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

		const states = new Map(
			blocks.map((block) => [block, this.host.store.resolve(path, block)]),
		);
		const currentLabels = new Set(
			blocks.map((block) =>
				normalizeLabel(states.get(block)?.selectedLabel ?? ''),
			),
		);
		const labels = unionLabels(blocks);
		const activeLabel =
			currentLabels.size === 1
				? labels.find((label) => currentLabels.has(normalizeLabel(label)))
				: undefined;
		const noteState = this.host.store.getNote(path);
		const globalLabel =
			labels.find(
				(label) =>
					normalizeLabel(label) === normalizeLabel(noteState?.globalLabel ?? ''),
			) ?? activeLabel;
		const views = new Set(
			blocks.map((block) => states.get(block)?.view),
		);
		const activeView: ViewMode | undefined =
			views.size === 1 ? [...views][0] : undefined;
		const globalView = noteState?.globalView ?? activeView;
		const responsiveModes = new Set(
			blocks.map((block) => states.get(block)?.responsive),
		);
		const activeResponsive: ResponsiveMode | undefined =
			responsiveModes.size === 1 ? [...responsiveModes][0] : undefined;
		const globalResponsive = noteState?.globalResponsive ?? activeResponsive;
		const columnsMode = globalView === 'columns';
		const visibleColumnLabels = columnsMode
			? new Set(
					labels.filter((label) => {
						const normalized = normalizeLabel(label);
						const matching = blocks.filter((block) =>
							block.variants.some(
								(variant) => variant.normalizedLabel === normalized,
							),
						);
						return matching.every(
							(block) => !states.get(block)?.hiddenLabels.has(normalized),
						);
					}),
				)
			: undefined;
		const differs = blocks.some(
			(block) => states.get(block)?.differsFromAuthored,
		);
		const allFollowingGlobal = blocks.every((block) =>
			this.host.store.isFollowingGlobalState(path, block),
		);
		const followingBlocks = blocks.filter((block) =>
			this.host.store.isFollowingGlobalState(path, block),
		);
		const reveal = control.createDiv({ cls: 'section-variants-reveal-controls' });
		createSegmentedControl(reveal, {
			cls: 'section-variants-labels',
			ariaLabel: columnsMode
				? 'Toggle columns across note'
				: 'Apply variant across note',
			value: columnsMode ? undefined : globalLabel,
			activeValues: visibleColumnLabels,
			options: labels.map((label) => {
				const action = visibleColumnLabels?.has(label) ? 'Hide' : 'Show';
				const description = columnsMode
					? `${action} ${label} column across note`
					: label;
				return {
					value: label,
					text: label,
					label: description,
					tooltip: columnsMode ? description : undefined,
				};
			}),
			onSelect: (label) => {
				if (columnsMode) {
					const result = this.host.store.toggleColumnAcrossNote(
						path,
						parsed,
						label,
					);
					new Notice(
						`${label} is now ${result.visible ? 'visible' : 'hidden'} in ${result.applied} block${result.applied === 1 ? '' : 's'}${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}.`,
					);
					return;
				}
				const result = this.host.store.applyLabelAcrossNote(path, parsed, label);
				new Notice(
					`Applied to ${result.applied} block${result.applied === 1 ? '' : 's'}, skipped ${result.skipped}.`,
				);
			},
		});
		if (columnsMode) {
			const hasHiddenColumn = followingBlocks.some((block) =>
				block.variants.some((variant) =>
					states.get(block)?.hiddenLabels.has(variant.normalizedLabel),
				),
			);
			const action = hasHiddenColumn ? 'Show all columns' : 'Hide all columns';
			const toggleAll = reveal.createEl('button', {
				type: 'button',
				cls: 'clickable-icon section-variants-toggle-all-columns',
				attr: {
					'aria-label': action,
					'aria-pressed': String(!hasHiddenColumn),
				},
			});
			setIcon(toggleAll, hasHiddenColumn ? 'eye' : 'eye-off');
			setTooltip(toggleAll, action);
			toggleAll.addEventListener('click', () => {
				this.host.store.toggleAllColumnsAcrossNote(path, parsed);
			});
		}
		createControlDivider(reveal);
		const globalFollowing = reveal.createEl('button', {
			type: 'button',
			cls: 'clickable-icon section-variants-global-follow-toggle',
			attr: {
				'aria-label': allFollowingGlobal
					? 'Use block-specific state everywhere'
					: 'Follow global state everywhere',
				'aria-pressed': String(allFollowingGlobal),
			},
		});
		setIcon(globalFollowing, 'globe-2');
		globalFollowing.toggleClass('is-active', allFollowingGlobal);
		setTooltip(
			globalFollowing,
			allFollowingGlobal
				? 'Use block-specific state everywhere'
				: 'Follow global state everywhere',
		);
		globalFollowing.addEventListener('click', () => {
			const following = !allFollowingGlobal;
			const result = this.host.store.setGlobalFollowingAcrossNote(
				path,
				parsed,
				following,
			);
			new Notice(
				`${result.applied} block${result.applied === 1 ? '' : 's'} now ${following ? 'follow global state' : 'use block-specific state'}.`,
			);
		});
		const layoutLabel = narrowLayoutLabel(
			globalResponsive ?? 'responsive',
		);
		const layoutMenu = reveal.createEl('button', {
			type: 'button',
			cls: 'clickable-icon section-variants-narrow-layout-menu',
			attr: {
				'aria-label': `Narrow-screen layout: ${layoutLabel}`,
				'aria-haspopup': 'menu',
			},
		});
		setIcon(layoutMenu, 'panel-top-dashed');
		setTooltip(layoutMenu, `Narrow-screen layout: ${layoutLabel}`);
		layoutMenu.addEventListener('click', (event) => {
			this.openNarrowLayoutMenu(event, path, globalResponsive);
		});
		createControlDivider(reveal);
		createSegmentedControl(reveal, {
			cls: 'section-variants-view-modes',
			ariaLabel: 'Apply view across note',
			value: globalView,
			options: VIEW_MODE_SEGMENTS,
			onSelect: (viewMode) => {
				this.host.store.applyViewAcrossNote(path, parsed, viewMode);
			},
		});
		createVariantMarker(control, {
			ariaLabel: 'Open note variants menu',
			tooltip: `${activeLabel ?? 'Mixed'} · ${activeView ? titleCase(activeView) : 'Mixed'}${columnsMode ? ` · ${activeResponsive ? narrowLayoutLabel(activeResponsive) : 'Mixed layout'}` : ''} · ${allFollowingGlobal ? 'all following global' : 'local block state present'}${differs ? ' · differs from defaults' : ''}`,
			followingGlobal: allFollowingGlobal,
			mixed:
				currentLabels.size > 1 ||
				views.size > 1 ||
				(columnsMode && responsiveModes.size > 1),
			onClick: (event) => this.openMenu(event, path),
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
	): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle('Hide note control').setIcon('x').onClick(() => {
				this.host.store.setStickyVisible(path, false);
				new Notice(
					`Note control hidden. Run “${SHOW_NOTE_CONTROL_COMMAND}” from the command palette to restore it.`,
				);
			}),
		);
		menu.showAtMouseEvent(event);
	}

	private openNarrowLayoutMenu(
		event: MouseEvent,
		path: string,
		activeResponsive: ResponsiveMode | undefined,
	): void {
		const menu = new Menu();
		for (const responsive of NARROW_LAYOUT_OPTIONS) {
			menu.addItem((item) =>
				item
					.setTitle(responsive.label)
					.setChecked(activeResponsive === responsive.value)
					.onClick(() => {
						this.host.store.applyResponsiveAcrossNote(path, responsive.value);
					}),
			);
		}
		menu.showAtMouseEvent(event);
	}
}

function createControlDivider(parent: HTMLElement): void {
	parent.createSpan({
		cls: 'section-variants-control-divider',
		attr: { role: 'separator', 'aria-orientation': 'vertical' },
	});
}

function titleCase(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function narrowLayoutLabel(value: ResponsiveMode): string {
	return NARROW_LAYOUT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
