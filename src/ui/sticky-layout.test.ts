import { describe, expect, it } from 'vitest';
import { bottomObstruction } from './sticky-layout';

describe('note-wide control bottom obstruction', () => {
	it('returns zero without a status bar or when it does not overlap', () => {
		expect(bottomObstruction({ top: 100, bottom: 900 })).toBe(0);
		expect(
			bottomObstruction(
				{ top: 100, bottom: 900 },
				{ top: 900, bottom: 940 },
			),
		).toBe(0);
		expect(
			bottomObstruction(
				{ top: 100, bottom: 900 },
				{ top: 400, bottom: 450 },
			),
		).toBe(0);
	});

	it('measures the status bar portion covering the Markdown view', () => {
		expect(
			bottomObstruction(
				{ top: 100, bottom: 900 },
				{ top: 856.2, bottom: 920 },
			),
		).toBe(44);
	});

	it('clamps an overlay extending beyond the whole view', () => {
		expect(
			bottomObstruction(
				{ top: 100, bottom: 300 },
				{ top: 50, bottom: 350 },
			),
		).toBe(200);
	});
});
