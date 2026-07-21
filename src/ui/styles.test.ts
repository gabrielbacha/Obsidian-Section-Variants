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

	it('keeps the toolbar inside the widget instead of translating it into clipping', () => {
		expect(CSS).toMatch(
			/\.section-variants-toolbar\s*\{[^}]*top:\s*var\(--size-2-1\)/su,
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

	it('contains nested editors and replaces their removed focus outline', () => {
		expect(CSS).toMatch(
			/\.section-variants-inline-editor \.cm-scroller\s*\{[^}]*overflow:\s*hidden/su,
		);
		expect(CSS).toMatch(
			/\.section-variants-panel\.is-editing:focus-within\s*\{[^}]*box-shadow:/su,
		);
		expect(CSS).toMatch(
			/\.section-variants-inline-editor \.cm-editor\.cm-focused\s*\{[^}]*outline:\s*none/su,
		);
	});

	it('does not animate grid layout properties', () => {
		expect(CSS).not.toMatch(/transition:\s*grid-template-columns/u);
	});
});
