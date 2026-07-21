import { describe, expect, it } from 'vitest';
import CSS from 'virtual:section-variants-styles';

describe('presentation safety selectors', () => {
	it('scopes authored print panels through direct block-content children', () => {
		expect(CSS).toContain(
		".section-variants-root[data-authored-view='toggle']\n\t\t> .section-variants-content\n\t\t> .section-variants-panel",
	);
		expect(CSS).not.toMatch(
		/\[data-authored-view='toggle'\]\s+\.section-variants-panel\s*\{/u,
	);
	});

	it('gives mobile column actions 44px targets', () => {
		expect(CSS).toMatch(
		/body\.is-mobile \.section-variants-column-header button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/su,
	);
	});

	it('gives the block add shortcut a 44px touch target', () => {
		expect(CSS).toMatch(
			/body\.is-mobile \.section-variants-add-variant,[^{]*\{[^}]*min-width:\s*44px/su,
		);
		expect(CSS).toMatch(
			/@media \(hover: none\), \(pointer: coarse\)[\s\S]*section-variants-add-variant[\s\S]*min-height:\s*44px/su,
		);
	});

	it('keeps attached context submenus viewport-positioned and touch accessible', () => {
		expect(CSS).toMatch(
			/\.section-variants-context-menu\s*\{[^}]*position:\s*fixed;[^}]*z-index:/su,
		);
		expect(CSS).toMatch(
			/body\.is-mobile \.section-variants-context-menu-item\s*\{[^}]*min-height:\s*44px;/su,
		);
		expect(CSS).not.toMatch(
			/\.section-variants-context-menu[^}]*transition:/su,
		);
	});

	it('uses one stable inner frame without a redundant outer border', () => {
		expect(CSS).toMatch(
			/\.section-variants-root\s*\{[^}]*border:\s*0/su,
		);
		expect(CSS).toMatch(
			/\.section-variants-content\s*\{[^}]*border:\s*1px solid/su,
		);
		expect(CSS).not.toContain('section-variants-live-border-line');
		expect(CSS).not.toContain('section-variants-live-anchor');
		expect(CSS).toContain('.section-variants-reveal-controls');
	});

	it('keeps a box name out of the responsive grid and aligned with controls', () => {
		expect(CSS).toMatch(
			/\.section-variants-block-name\s*\{[^}]*position:\s*absolute/su,
		);
		expect(CSS).toMatch(
			/\.section-variants-content\.has-block-name\s*\{[^}]*padding-block-start:/su,
		);
		expect(CSS).toMatch(
			/\.section-variants-root\.has-block-name\s*>\s*\.section-variants-toolbar\s*\{[^}]*top:/su,
		);
		expect(CSS).toMatch(
			/grid-template-columns:\s*repeat\(\s*auto-fit,[\s\S]*1fr/su,
		);
	});

	it('removes spacing only from a leading variant heading', () => {
		expect(CSS).toContain('> .HyperMD-header:first-child');
		expect(CSS).toMatch(
			/section-variants-column-header[\s\S]*\+ :is\(h1, h2, h3, h4, h5, h6\)[\s\S]*margin-block-start:\s*0 !important/su,
		);
	});

	it('keeps the toolbar inside the widget instead of translating it into clipping', () => {
		expect(CSS).toMatch(
			/\.section-variants-toolbar\s*\{[^}]*top:\s*var\(--size-2-2\)[^}]*padding:\s*2px/su,
		);
		expect(CSS).not.toMatch(
			/\.section-variants-toolbar\s*\{[^}]*transform:\s*translateY\(-50%\)/su,
		);
	});

	it('pins the note-wide control to the bottom safe area', () => {
		expect(CSS).toMatch(
			/\.section-variants-sticky-control\s*\{[^}]*right:[^;]*safe-area-inset-right[^;]*;[^}]*bottom:[^}]*section-variants-bottom-obstruction[^}]*safe-area-inset-bottom/su,
		);
	});

	it('contains nested editors without adding an internal editing frame', () => {
		expect(CSS).toMatch(
			/\.section-variants-inline-editor \.cm-scroller\s*\{[^}]*overflow:\s*hidden/su,
		);
		expect(CSS).not.toContain(
			'.section-variants-panel.is-editing:focus-within',
		);
		expect(CSS).toMatch(
			/\.section-variants-inline-editor \.cm-editor\.cm-focused\s*\{[^}]*outline:\s*none/su,
		);
	});

	it('does not animate grid layout properties', () => {
		expect(CSS).not.toMatch(/transition:\s*grid-template-columns/u);
	});

	it('switches wrapped grid rows to horizontal separators', () => {
		expect(CSS).toMatch(
			/section-variants-column-later-row[^}]*border-block-start:\s*1px solid/su,
		);
		expect(CSS).toMatch(
			/section-variants-column-row-start[^}]*border-inline-start:\s*0/su,
		);
	});

	it('clears first-row variant actions below the floating block toolbar', () => {
		expect(CSS).toMatch(
			/section-variants-panel:not\(\.section-variants-column-later-row\)[^}]*section-variants-column-actions\s*\{[^}]*margin-block-start:\s*var\(--size-4-3\)/su,
		);
	});
});
