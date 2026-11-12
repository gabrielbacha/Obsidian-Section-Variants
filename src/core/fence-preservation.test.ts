import { describe, expect, it } from 'vitest';
import { patchContainerOpening, patchVariantOpening } from './serializer';

describe('authored fence token changes', () => {
	it('changes a name without replacing its alias, classes, ID or legacy layout', () => {
		const raw = ':::: {.parallel .custom #keep name="Old" view=auto widths="2 1"}';
		expect(patchContainerOpening(raw, { id: 'keep', name: 'Old', view: 'columns', widths: '2 1' },
			{ id: 'keep', name: 'New', view: 'columns', widths: '2 1' })).toBe(raw.replace('"Old"', '"New"'));
	});
	it('preserves explicit variant classes and ID when renaming', () => {
		const raw = '::: {.variant .special #variant-id label="A"}';
		expect(patchVariantOpening(raw, 'Name "B"')).toBe('::: {.variant .special #variant-id label="Name \\"B\\""}');
	});
	it('adds or removes only requested attributes', () => {
		expect(patchContainerOpening(':::: {.variants #stable view=auto}', { id: 'stable', view: 'columns' },
			{ id: 'stable', view: 'columns', name: 'Added' })).toBe(':::: {.variants #stable view=auto name="Added"}');
	});
});
