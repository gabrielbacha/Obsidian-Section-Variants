import { describe, expect, it } from 'vitest';
import { LatestPathGeneration } from './latest-path-generation';

describe('latest path generation', () => {
	it('invalidates stale work per path without affecting other notes', () => {
		const generations = new LatestPathGeneration();
		const firstA = generations.next('A.md');
		const firstB = generations.next('B.md');
		const secondA = generations.next('A.md');

		expect(generations.isCurrent('A.md', firstA)).toBe(false);
		expect(generations.isCurrent('A.md', secondA)).toBe(true);
		expect(generations.isCurrent('B.md', firstB)).toBe(true);

		generations.invalidate('B.md');
		expect(generations.isCurrent('B.md', firstB)).toBe(false);
	});
});
