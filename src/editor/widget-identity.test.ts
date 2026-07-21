import { describe, expect, it } from 'vitest';
import { parseNote } from '../core/parser';
import { widgetPositionIdentity } from './widget-identity';

const BLOCK = [
	':::: variants',
	'::: A',
	'One',
	':::',
	'::: B',
	'Two',
	':::',
	'::::',
].join('\n');

describe('Live Preview widget equality inputs', () => {
	it('change when identical block source moves after an edit above it', () => {
		const before = parseNote(BLOCK).blocks[0]!;
		const after = parseNote(`Inserted above\n${BLOCK}`).blocks[0]!;
		expect(before.fingerprint).toBe(after.fingerprint);
		expect(widgetPositionIdentity(before)).not.toBe(widgetPositionIdentity(after));
	});
});
