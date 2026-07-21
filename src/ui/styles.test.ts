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
});
