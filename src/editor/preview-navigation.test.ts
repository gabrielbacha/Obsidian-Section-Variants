import { EditorState, StateEffect, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, expect, it, vi } from 'vitest';
import { navigationForPreview, PreviewNavigationOwner } from './preview-navigation';

const owners: PreviewNavigationOwner[] = [];
afterEach(() => { owners.splice(0).forEach(owner => owner.destroy()); vi.useRealTimers(); });

function fixture() {
	let scope = 'First.md';
	const jobs: Array<{ read(): unknown; write(value: unknown): void }> = [];
	const dom = new EventTarget();
	const view = { state: EditorState.create({ doc: 'Before\nTarget\nAfter' }), dom,
		requestMeasure: (job: { read(): unknown; write(value: unknown): void }) => { jobs.push(job); },
		dispatch: vi.fn<(spec: TransactionSpec) => void>(),
	};
	const native = view as unknown as EditorView;
	const owner = new PreviewNavigationOwner(native, () => scope); owners.push(owner);
	view.dispatch.mockImplementation(spec => { const transaction = view.state.update(spec); view.state = transaction.state; owner.update([transaction]); });
	const capture = (effect = EditorView.scrollIntoView(7, { y: 'center' })) => {
		const transaction = view.state.update({ effects: effect }); view.state = transaction.state; owner.update([transaction]);
		return navigationForPreview(native)?.navigation;
	};
	const flush = async () => { for (const job of jobs.splice(0)) job.write(job.read()); await Promise.resolve(); };
	return { view, native, owner, dom, capture, flush, setScope: (path: string) => { scope = path; } };
}

it('coalesces height changes and reuses the original native effect without changing its range or options', async () => {
	const f = fixture(); const effect = EditorView.scrollIntoView(7, { y: 'center', x: 'start', yMargin: 37 });
	const navigation = f.capture(effect)!;
	f.owner.measure(navigation); f.owner.measure(navigation); await f.flush();
	expect(f.view.dispatch).toHaveBeenCalledOnce();
	expect(f.view.dispatch.mock.calls[0]![0].effects).toBe(effect);
	f.owner.measure(navigation); await f.flush();
	expect(f.view.dispatch).toHaveBeenCalledTimes(2);
});

it('does not replay another producer that uses an identical native payload', () => {
	const f = fixture(); const native = EditorView.scrollIntoView(7);
	expect(f.capture(StateEffect.define<unknown>().of(native.value))).toBeUndefined();
});

it('a later navigation cancels the old measured request', async () => {
	const f = fixture(); const old = f.capture()!; f.owner.measure(old);
	const effect = EditorView.scrollIntoView(14); const current = f.capture(effect)!;
	f.owner.measure(current); await f.flush();
	expect(f.view.dispatch).toHaveBeenCalledOnce(); expect(f.view.dispatch.mock.calls[0]![0].effects).toBe(effect);
});

it.each(['wheel', 'pointerdown', 'keydown'])('%s cancels a queued correction before it can move the user', async event => {
	const f = fixture(); f.owner.measure(f.capture()!); f.dom.dispatchEvent(new Event(event));
	await f.flush(); expect(f.view.dispatch).not.toHaveBeenCalled();
});

it('note changes and unload cancel late measurements', async () => {
	const f = fixture(); const navigation = f.capture()!; f.owner.measure(navigation);
	const changed = f.view.state.update({ changes: { from: 0, insert: 'New\n' } }); f.view.state = changed.state; f.owner.update([changed]);
	await f.flush(); expect(f.view.dispatch).not.toHaveBeenCalled();
	f.owner.measure(f.capture()!); f.owner.destroy(); await f.flush();
	expect(f.view.dispatch).not.toHaveBeenCalled(); expect(navigationForPreview(f.native)).toBeUndefined();
});

it('bounds corrections and refuses expired native work', async () => {
	vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(0);
	const f = fixture(); const navigation = f.capture()!;
	for (let i = 0; i < 8; i++) { f.owner.measure(navigation); await f.flush(); }
	expect(f.view.dispatch).toHaveBeenCalledTimes(6);
	const later = f.capture()!; vi.setSystemTime(5001); f.owner.measure(later); await f.flush();
	expect(f.view.dispatch).toHaveBeenCalledTimes(6);
});

it('keeps separate native windows under separate owners', async () => {
	const first = fixture(); const second = fixture();
	first.owner.measure(first.capture()!); second.owner.measure(second.capture()!); first.dom.dispatchEvent(new Event('wheel'));
	await first.flush(); await second.flush();
	expect(first.view.dispatch).not.toHaveBeenCalled(); expect(second.view.dispatch).toHaveBeenCalledOnce();
});

it('old unload cannot remove the replacement owner of the same native view', () => {
	const f = fixture(); const replacement = new PreviewNavigationOwner(f.native); owners.push(replacement);
	f.owner.destroy();
	const transaction = f.view.state.update({ effects: EditorView.scrollIntoView(7) }); f.view.state = transaction.state;
	replacement.update([transaction]);
	expect(navigationForPreview(f.native)?.owner).toBe(replacement);
});

it('an identical document in another note cannot receive the old navigation', async () => {
	const f = fixture(); f.owner.measure(f.capture()!); f.setScope('Second.md');
	await f.flush(); expect(f.view.dispatch).not.toHaveBeenCalled();
});
