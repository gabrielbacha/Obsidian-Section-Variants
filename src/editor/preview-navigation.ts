import { Annotation, StateEffect, Transaction } from '@codemirror/state';
import type { StateEffectType } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const replay = Annotation.define<boolean>();
// This factory adapter identifies the producer, not a lookalike payload. If the
// current host stops exposing its producer, leave its native effects untouched.
// Never read or change the editor's private scroll state or effect payload.
const scrollType = (EditorView.scrollIntoView(0) as unknown as { type?: StateEffectType<unknown> }).type;

export interface PreviewNavigation {
	effect: StateEffect<unknown>;
	document: EditorView['state']['doc'];
	scope: string | undefined;
	expires: number;
	corrections: number;
}

const owners = new WeakMap<EditorView, PreviewNavigationOwner>();

/** Retain a cold navigation only for widgets mounted by that request. */
export class PreviewNavigationOwner {
	private current?: PreviewNavigation;
	private mounting?: PreviewNavigation;
	private queued = false;
	private pending?: PreviewNavigation;
	private destroyed = false;

	constructor(private readonly view: EditorView, private readonly getScope: () => string | undefined = () => undefined) {
		owners.set(view, this);
		for (const event of ['wheel', 'pointerdown', 'keydown']) view.dom.addEventListener(event, this.cancel, true);
	}

	update(transactions: readonly Transaction[]): void {
		if (this.destroyed) return;
		for (const transaction of transactions) {
			if (transaction.docChanged) this.cancel();
			if (transaction.annotation(replay)) continue;
			let effect = transaction.scrollIntoView ? EditorView.scrollIntoView(transaction.state.selection.main) : undefined;
			for (const candidate of transaction.effects) {
				if (scrollType && typeof scrollType.of === 'function' && candidate.is(scrollType)) effect = candidate;
			}
			if (!effect) continue;
			const navigation = { effect, document: this.view.state.doc, scope: this.getScope(), expires: Date.now() + 5000, corrections: 0 };
			this.current = this.mounting = navigation;
			queueMicrotask(() => { if (this.mounting === navigation) this.mounting = undefined; });
		}
	}

	get mountedNavigation(): PreviewNavigation | undefined { return this.mounting; }

	measure(navigation: PreviewNavigation): void {
		if (!this.valid(navigation)) return;
		this.pending = navigation;
		if (this.queued) return;
		this.queued = true;
		this.view.requestMeasure({
			key: this,
			read: () => undefined,
			write: () => {
				// State dispatch runs after the editor's height-map measurement ends.
				queueMicrotask(() => {
					this.queued = false;
					const current = this.pending;
					this.pending = undefined;
					if (!current || !this.valid(current)) return;
					current.corrections++;
					this.view.dispatch({ effects: current.effect, annotations: replay.of(true) });
				});
			},
		});
	}

	private valid(navigation: PreviewNavigation): boolean {
		return !this.destroyed && this.current === navigation && navigation.document === this.view.state.doc && navigation.scope === this.getScope() && navigation.corrections < 6 && Date.now() <= navigation.expires;
	}

	private readonly cancel = (): void => { this.current = this.mounting = this.pending = undefined; };

	destroy(): void {
		this.destroyed = true;
		this.cancel();
		for (const event of ['wheel', 'pointerdown', 'keydown']) this.view.dom.removeEventListener(event, this.cancel, true);
		if (owners.get(this.view) === this) owners.delete(this.view);
	}
}

export function navigationForPreview(view: EditorView): { owner: PreviewNavigationOwner; navigation: PreviewNavigation } | undefined {
	const owner = owners.get(view);
	const navigation = owner?.mountedNavigation;
	return owner && navigation ? { owner, navigation } : undefined;
}
