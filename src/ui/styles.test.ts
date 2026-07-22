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

	it('gives the global all-columns toggle a 44px touch target', () => {
		expect(CSS).toMatch(
			/body\.is-mobile \.section-variants-add-variant,[^{]*\.section-variants-toggle-all-columns,[^{]*\{[^}]*min-width:\s*44px/su,
		);
	});

	it('gives the global-follow toggle a 44px touch target and a pressed state', () => {
		expect(CSS).toMatch(
			/body\.is-mobile \.section-variants-add-variant,[^{]*\.section-variants-global-follow-toggle\s*\{[^}]*min-width:\s*44px/su,
		);
		expect(CSS).toMatch(
			/\.section-variants-global-follow-toggle\[aria-pressed='true'\]\s*\{[^}]*background:/su,
		);
		expect(CSS).toMatch(
			/button\.section-variants-global-follow-toggle\s*\{[^}]*box-sizing:\s*border-box;[^}]*border:\s*1px solid/su,
		);
	});

	it('bridges the pointer path between a marker and its revealed controls', () => {
		expect(CSS).toMatch(
			/\.section-variants-sticky-control\s*>\s*\.section-variants-reveal-controls\s*\{[^}]*right:\s*100%;[^}]*padding-inline-end:\s*var\(--size-2-1\)/su,
		);
		expect(CSS).not.toContain('right: calc(100% + var(--size-2-1))');
	});

	it('visually separates global control groups', () => {
		expect(CSS).toMatch(
			/\.section-variants-control-divider\s*\{[^}]*width:\s*1px;[^}]*height:\s*14px;[^}]*margin-inline:\s*var\(--size-2-1\)/su,
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

	it('highlights hover, keyboard focus, and open submenu items', () => {
		expect(CSS).toMatch(
			/\.section-variants-context-menu-item:not\(\.is-disabled\):is\([\s\S]*:hover,[\s\S]*:focus-visible,[\s\S]*\[aria-expanded='true'\][\s\S]*\)\s*\{[^}]*background:\s*var\(--background-modifier-hover\)/su,
		);
	});

	it('renders checked menu choices as explicit checkbox controls', () => {
		expect(CSS).toMatch(
			/\.section-variants-context-menu-checkbox\s*\{[^}]*border:\s*1px solid/su,
		);
		expect(CSS).toMatch(
			/\.section-variants-context-menu-item\[aria-checked='true'\][\s\S]*\.section-variants-context-menu-checkbox\s*\{[^}]*background:\s*var\(--interactive-accent\)/su,
		);
	});

	it('reserves the blue marker dot for global following', () => {
		expect(CSS).toContain('.section-variants-marker.is-following-global::after');
		expect(CSS).not.toContain('.section-variants-marker.has-difference::after');
		expect(CSS).toMatch(
			/\.section-variants-context-menu-badge\s*\{[^}]*color:\s*var\(--text-warning\)/su,
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

	it('reserves a small vertical gap between the toolbar and first variant', () => {
		expect(CSS).toMatch(
			/\.section-variants-content\s*\{[^}]*padding-block-start:\s*calc\([\s\S]*section-variants-control-size[\s\S]*size-2-1/su,
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

	it('aligns variant titles and actions below the toolbar row', () => {
		expect(CSS).toMatch(
			/\.section-variants-column-header\s*\{[^}]*align-items:\s*center/su,
		);
		expect(CSS).not.toMatch(
			/section-variants-column-header\s*\{[^}]*padding-inline-end:/su,
		);
		expect(CSS).not.toMatch(/section-variants-column-actions\s*\{[^}]*margin-block-start:/su);
	});
});
