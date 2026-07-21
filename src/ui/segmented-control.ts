import { setIcon, setTooltip } from 'obsidian';

export interface SegmentOption<T extends string> {
	value: T;
	/** Visible text. Omitted for icon-only segments. */
	text?: string;
	/** Lucide icon name. Used instead of text when provided. */
	icon?: string;
	/** Accessible name. Required when the segment is icon-only. */
	label: string;
	tooltip?: string;
}

export interface SegmentedControlOptions<T extends string> {
	options: SegmentOption<T>[];
	value: T | undefined;
	/** Multiple active values turn the segments into independent toggles. */
	activeValues?: ReadonlySet<T>;
	onSelect: (value: T, event: MouseEvent) => void;
	/** Accessible name for the group. */
	ariaLabel: string;
	cls?: string;
}

/**
 * A single pill holding mutually exclusive choices, styled to sit quietly in a
 * note. Replaces the native `<select>` controls the block toolbar and sticky
 * control used to build, per PRD §8.
 *
 * Implements the radiogroup pattern: one tab stop for the whole group, arrow
 * keys move between segments.
 */
export function createSegmentedControl<T extends string>(
	parent: HTMLElement,
	{
		options,
		value,
		onSelect,
		ariaLabel,
		cls,
		activeValues,
	}: SegmentedControlOptions<T>,
): HTMLElement {
	const group = parent.createDiv({
		cls: `section-variants-segmented${cls ? ` ${cls}` : ''}`,
	});
	group.setAttribute('role', activeValues ? 'group' : 'radiogroup');
	group.setAttribute('aria-label', ariaLabel);

	const buttons: HTMLButtonElement[] = [];
	// When nothing matches (e.g. blocks disagree), the first segment carries the
	// tab stop so the group stays reachable.
	const selectedIndex = options.findIndex((option) =>
		activeValues ? activeValues.has(option.value) : option.value === value,
	);
	const tabStop = selectedIndex === -1 ? 0 : selectedIndex;

	options.forEach((option, index) => {
		const button = group.createEl('button', {
			cls: 'section-variants-segment',
			type: 'button',
		});
		const isSelected = activeValues
			? activeValues.has(option.value)
			: index === selectedIndex;
		if (activeValues) button.setAttribute('aria-pressed', String(isSelected));
		else {
			button.setAttribute('role', 'radio');
			button.setAttribute('aria-checked', String(isSelected));
		}
		button.setAttribute('aria-label', option.label);
		button.tabIndex = index === tabStop ? 0 : -1;
		button.toggleClass('is-active', isSelected);

		if (option.icon) {
			setIcon(button, option.icon);
			button.addClass('section-variants-segment-icon');
		} else {
			button.setText(option.text ?? option.label);
		}
		if (option.tooltip) setTooltip(button, option.tooltip);

		button.addEventListener('click', (event) => onSelect(option.value, event));
		button.addEventListener('keydown', (event) => {
			const delta =
				event.key === 'ArrowRight' || event.key === 'ArrowDown'
					? 1
					: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
						? -1
						: 0;
			if (delta === 0) return;
			event.preventDefault();
			const next = buttons[(index + delta + buttons.length) % buttons.length];
			if (!next) return;
			for (const other of buttons) other.tabIndex = -1;
			next.tabIndex = 0;
			next.focus();
		});

		buttons.push(button);
	});

	return group;
}

export const VIEW_MODE_SEGMENTS: SegmentOption<'toggle' | 'columns' | 'auto'>[] = [
	{ value: 'toggle', icon: 'rows-2', label: 'Toggle', tooltip: 'Show one variant' },
	{
		value: 'columns',
		icon: 'columns-2',
		label: 'Columns',
		tooltip: 'Compare variants side by side',
	},
	{ value: 'auto', icon: 'wand-2', label: 'Auto', tooltip: 'Choose based on width' },
];
