import { describe, expect, it } from 'vitest';
import { rootMenuPosition, submenuPosition } from './attached-menu';

describe('attached context menu positioning', () => {
	it('clamps the root menu inside the owner viewport', () => {
		expect(
			rootMenuPosition(
				{ x: 390, y: 290 },
				{ width: 120, height: 100 },
				{ width: 400, height: 300 },
			),
		).toEqual({ x: 280, y: 200 });
	});

	it('attaches right when there is room and flips left at the edge', () => {
		const viewport = { width: 500, height: 300 };
		const size = { width: 140, height: 120 };
		expect(
			submenuPosition({ left: 100, right: 260, top: 40 }, size, viewport),
		).toEqual({ x: 260, y: 40 });
		expect(
			submenuPosition({ left: 350, right: 490, top: 250 }, size, viewport),
		).toEqual({ x: 210, y: 180 });
	});
});
