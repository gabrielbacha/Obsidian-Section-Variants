import { describe, expect, it } from 'vitest';
import {
	isStructuralTransaction,
	runStructuralTransaction,
} from './structural-transaction';

describe('structural editor transaction context', () => {
	it('is active only during the synchronous transaction and resets after errors', () => {
		expect(isStructuralTransaction()).toBe(false);
		expect(
			runStructuralTransaction(() => isStructuralTransaction()),
		).toBe(true);
		expect(isStructuralTransaction()).toBe(false);
		expect(() => runStructuralTransaction(() => {
			throw new Error('stop');
		})).toThrow('stop');
		expect(isStructuralTransaction()).toBe(false);
	});
});
