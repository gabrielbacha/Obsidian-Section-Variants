import { describe, expect, it } from 'vitest';
import { chooseMutationEditor } from './mutation-target';

describe('structural mutation editor selection', () => {
	it('prefers the exact originating pane over another active pane', () => {
		expect(
			chooseMutationEditor([
				{ editor: 'active', containsOrigin: false, sameDocument: true, active: true },
				{ editor: 'origin', containsOrigin: true, sameDocument: true, active: false },
			]),
		).toBe('origin');
	});

	it('prefers the originating pop-out document, then active, then first', () => {
		expect(
			chooseMutationEditor([
				{ editor: 'main', containsOrigin: false, sameDocument: false, active: true },
				{ editor: 'popout', containsOrigin: false, sameDocument: true, active: false },
			]),
		).toBe('popout');
		expect(
			chooseMutationEditor([
				{ editor: 'first', containsOrigin: false, sameDocument: false, active: false },
				{ editor: 'active', containsOrigin: false, sameDocument: false, active: true },
			]),
		).toBe('active');
	});
});
