import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';
import { parseNote } from '../core/parser';
import { migrateData, StateStore } from './store';

afterEach(() => vi.unstubAllGlobals());

describe('state migration', () => {
	it('migrates version 1 while dropping retired chrome and inactive fields', () => {
		const migrated = migrateData({
			version: 1,
			vaultToken: 'vault-token',
			settings: {
				defaultView: 'columns',
				defaultMinWidth: '20rem',
				livePreviewInactive: 'collapsed',
				responsiveBehavior: 'stack',
				stickyControlEnabled: false,
				toolbarVisibility: 'always',
				automaticBlockIds: true,
				aliases: ['variants', 'versions'],
				exportState: 'current',
				showIndicators: false,
			},
			notes: {
				'Note.md': {
					globalLabel: 'B',
					globalView: 'auto',
					stickyVisible: false,
					inactiveBehavior: 'collapsed',
					blocks: {
						'block:stable': {
							selectedLabel: 'B',
							view: 'columns',
							savedHiddenLabels: ['C'],
							toolbarPinned: true,
							inactiveBehavior: 'hidden',
						},
					},
				},
			},
		});

		expect(migrated.data.version).toBe(3);
		expect(migrated.data.settings).toEqual({
			defaultView: 'columns',
			defaultMinWidth: '20rem',
			stickyControlEnabled: false,
			automaticBlockIds: true,
			aliases: ['variants', 'versions'],
			exportState: 'current',
			showIndicators: false,
		});
		expect(migrated.data.notes['Note.md']).toEqual({
			globalLabel: 'B',
			globalView: 'columns',
			stickyVisible: false,
			blocks: {
				'block:stable': {
					selectedLabel: 'B',
					view: 'columns',
					savedHiddenLabels: ['C'],
					globalMode: 'local',
				},
			},
		});
	});

	it('backs up data from an unknown newer schema', () => {
		const loaded = { version: 99, future: true };
		const migrated = migrateData(loaded);
		expect(migrated.data.version).toBe(3);
		expect(migrated.data.backup).toEqual(loaded);
		expect(migrated.warning).toMatch(/newer version/iu);
	});

	it('migrates schema 2 to 3 and preserves authored markers and state', () => {
		const migrated = migrateData({
			version: 2,
			vaultToken: 'v2-token',
			settings: { defaultView: 'auto' },
			notes: {
				'Note.md': {
					globalLabel: 'B',
					globalView: 'columns',
					stickyVisible: false,
					blocks: {
						'block:one': {
							selectedLabel: 'B',
							view: 'auto',
							savedHiddenLabels: ['A'],
							labelMode: 'authored',
							viewMode: 'authored',
						},
					},
				},
			},
		});

		expect(migrated.data.version).toBe(3);
		expect(migrated.data.settings.defaultView).toBe('columns');
		expect(migrated.data.notes['Note.md']).toMatchObject({
			globalLabel: 'B',
			globalView: 'columns',
			stickyVisible: false,
			blocks: {
				'block:one': {
					selectedLabel: 'B',
					view: 'columns',
					savedHiddenLabels: ['A'],
					labelMode: 'authored',
					viewMode: 'authored',
					globalMode: 'local',
				},
			},
		});
	});
});

describe('state identity migration', () => {
	it('emits block, note, and settings-scoped changes', async () => {
		const store = await createStore();
		const block = parseNote(blockSource()).blocks[0]!;
		const changes: Array<{ scope: string; path?: string; blockKey?: string }> = [];
		store.subscribe((change) => changes.push(change));

		store.setSelectedLabel('Note.md', block, 'B');
		store.setStickyVisible('Note.md', false);
		store.updateSettings({ ...store.settings, showIndicators: false });

		expect(changes).toEqual([
			{ scope: 'block', path: 'Note.md', blockKey: block.identityKey },
			{ scope: 'note', path: 'Note.md' },
			{ scope: 'settings' },
		]);
	});

	it('rekeys persisted and session state after ID creation', async () => {
		const store = await createStore();
		const before = parseNote(blockSource()).blocks[0]!;
		const after = parseNote(`${blockSource()}\n^variants-stable`).blocks[0]!;
		store.setSelectedLabel('Note.md', before, 'B');
		store.toggleHidden('Note.md', before, 'A');
		store.setEditingVariant('Note.md', before, 'B');

		store.rekeyBlockState('Note.md', before, after);

		expect(store.getNote('Note.md')?.blocks[before.identityKey]).toBeUndefined();
		expect(store.resolve('Note.md', after).selectedLabel).toBe('B');
		expect(store.resolve('Note.md', after).hiddenLabels.has('a')).toBe(true);
		expect(store.getEditingVariant('Note.md', after)).toBe('B');
	});

	it('migrates local rename state while leaving a note-wide label local', async () => {
		const store = await createStore();
		const before = parseNote(blockSource()).blocks[0]!;
		const after = parseNote(blockSource().replace('::: A', '::: Alpha')).blocks[0]!;
		const note = store.getNote('Note.md', true)!;
		note.globalLabel = 'A';
		store.setSelectedLabel('Note.md', before, 'A');
		store.toggleHidden('Note.md', before, 'A');
		store.setEditingVariant('Note.md', before, 'A');

		store.migrateRenamedLabels(
			'Note.md',
			[{ before, after }],
			'A',
			'Alpha',
			false,
		);

		expect(note.globalLabel).toBe('A');
		expect(store.resolve('Note.md', after).selectedLabel).toBe('Alpha');
		expect(store.resolve('Note.md', after).hiddenLabels.has('alpha')).toBe(true);
		expect(store.getEditingVariant('Note.md', after)).toBe('Alpha');
	});

	it('migrates the global label for an across-note rename', async () => {
		const store = await createStore();
		const before = parseNote(blockSource()).blocks[0]!;
		const after = parseNote(blockSource().replace('::: A', '::: Alpha')).blocks[0]!;
		store.getNote('Note.md', true)!.globalLabel = 'A';

		store.migrateRenamedLabels(
			'Note.md',
			[{ before, after }],
			'A',
			'Alpha',
			true,
		);

		expect(store.getNote('Note.md')?.globalLabel).toBe('Alpha');
		expect(store.resolve('Note.md', after).selectedLabel).toBe('Alpha');
	});

	it('rekeys state and removes references to a deleted variant', async () => {
		const store = await createStore();
		const before = parseNote(
			blockSource().replace('::: B\nTwo\n:::', '::: B\nTwo\n:::\n::: C\nThree\n:::'),
		).blocks[0]!;
		const after = parseNote(blockSource().replace('::: B\nTwo\n:::', '::: C\nThree\n:::')).blocks[0]!;
		store.setSelectedLabel('Note.md', before, 'B');
		store.toggleHidden('Note.md', before, 'B');
		store.saveHidden('Note.md', before);
		store.setEditingVariant('Note.md', before, 'B');

		store.migrateDeletedVariant('Note.md', before, after, 'B');

		expect(store.resolve('Note.md', after).selectedLabel).toBe('A');
		expect(store.resolve('Note.md', after).hiddenLabels.has('b')).toBe(false);
		expect(store.getEditingVariant('Note.md', after)).toBeUndefined();
	});

	it('full global following clears local and authored modes together', async () => {
		const store = await createStore();
		const block = parseNote(blockSource()).blocks[0]!;
		const note = store.getNote('Note.md', true)!;
		note.globalLabel = 'B';
		note.globalView = 'columns';
		store.resetBlock('Note.md', block);
		store.setSelectedLabel('Note.md', block, 'A');
		store.setView('Note.md', block, 'toggle');

		const followed = store.followGlobalState('Note.md', block);

		expect(followed).toEqual({ label: true, view: true });
		expect(store.resolve('Note.md', block)).toMatchObject({
			selectedLabel: 'B',
			view: 'columns',
		});
		expect(note.blocks[block.identityKey]).toBeUndefined();
		expect(store.isFollowingGlobalState('Note.md', block)).toBe(true);
	});

	it('turning global following off freezes the current label and view locally', async () => {
		const store = await createStore();
		const block = parseNote(blockSource()).blocks[0]!;
		const note = store.getNote('Note.md', true)!;
		note.globalLabel = 'B';
		note.globalView = 'columns';
		expect(store.isFollowingGlobalState('Note.md', block)).toBe(true);

		store.unfollowGlobalState('Note.md', block);
		store.applyLabelAcrossNote('Note.md', parseNote(blockSource()), 'A');
		store.applyViewAcrossNote('Note.md', parseNote(blockSource()), 'toggle');

		expect(store.isFollowingGlobalState('Note.md', block)).toBe(false);
		expect(store.resolve('Note.md', block)).toMatchObject({
			selectedLabel: 'B',
			view: 'columns',
		});

		store.followGlobalState('Note.md', block);
		expect(store.isFollowingGlobalState('Note.md', block)).toBe(true);
		expect(store.resolve('Note.md', block)).toMatchObject({
			selectedLabel: 'A',
			view: 'toggle',
		});
	});

	it('shows untouched blocks as following even before a global choice exists', async () => {
		const store = await createStore();
		const block = parseNote(blockSource()).blocks[0]!;

		expect(store.isFollowingGlobalState('Note.md', block)).toBe(true);
		store.unfollowGlobalState('Note.md', block);
		expect(store.isFollowingGlobalState('Note.md', block)).toBe(false);
	});

	it('clears inline editing when its column or view becomes unavailable', async () => {
		const store = await createStore();
		const block = parseNote(blockSource()).blocks[0]!;
		store.setView('Note.md', block, 'columns');
		store.setEditingVariant('Note.md', block, 'B');

		store.toggleHidden('Note.md', block, 'B');
		expect(store.getEditingVariant('Note.md', block)).toBeUndefined();

		store.restoreColumns('Note.md', block);
		expect(store.resolve('Note.md', block).hiddenLabels.size).toBe(0);
		store.setEditingVariant('Note.md', block, 'A');
		store.setView('Note.md', block, 'toggle');
		expect(store.getEditingVariant('Note.md', block)).toBeUndefined();

		store.setEditingVariant('Note.md', block, 'A');
		store.getNote('Note.md', true)!.globalView = 'toggle';
		store.followGlobalState('Note.md', block);
		expect(store.getEditingVariant('Note.md', block)).toBeUndefined();
	});

	it('toggles a matching column all off or all on across the note', async () => {
		const store = await createStore();
		const parsed = parseNote([
			blockSource(),
			blockSource().replace('::: B\nTwo', '::: C\nThree'),
			blockSource()
				.replace('::: A\nOne', '::: D\nFour')
				.replace('::: B\nTwo', '::: E\nFive'),
		].join('\n\n'));
		const [first, second] = parsed.blocks;
		if (!first || !second) throw new Error('Missing fixture blocks');
		store.setEditingVariant('Note.md', first, 'A');

		const hidden = store.toggleColumnAcrossNote('Note.md', parsed, 'A');
		expect(hidden).toEqual({ visible: false, applied: 2, skipped: 1 });
		expect(store.resolve('Note.md', first).hiddenLabels.has('a')).toBe(true);
		expect(store.resolve('Note.md', second).hiddenLabels.has('a')).toBe(true);
		expect(store.getEditingVariant('Note.md', first)).toBeUndefined();

		store.toggleHidden('Note.md', first, 'A');
		const shown = store.toggleColumnAcrossNote('Note.md', parsed, 'A');
		expect(shown).toEqual({ visible: true, applied: 2, skipped: 1 });
		expect(store.resolve('Note.md', first).hiddenLabels.has('a')).toBe(false);
		expect(store.resolve('Note.md', second).hiddenLabels.has('a')).toBe(false);
	});
});

async function createStore(): Promise<StateStore> {
	vi.stubGlobal('window', {
		setTimeout: () => 1,
		clearTimeout: () => undefined,
		localStorage: { removeItem: () => undefined },
	});
	const plugin = {
		loadData: async () => ({ version: 3, vaultToken: 'test', settings: {}, notes: {} }),
		saveData: async () => undefined,
	} as unknown as Plugin;
	const store = new StateStore(plugin);
	await store.load();
	return store;
}

function blockSource(): string {
	return [':::: variants', '::: A', 'One', ':::', '::: B', 'Two', ':::', '::::'].join(
		'\n',
	);
}
