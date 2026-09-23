import { EditorView, ViewUpdate } from '@codemirror/view';

export interface NativeFrameRange { from: number; to: number }

/** Draw around the native document, including Obsidian's block widgets.
 * No editor nodes are moved and no prose-line styles are changed. */
export class NativeFrames {
	private readonly layer: HTMLElement;
	private readonly observer: ResizeObserver;
	private destroyed = false;

	constructor(private readonly view: EditorView, private readonly ranges: () => readonly NativeFrameRange[]) {
		this.layer = view.dom.ownerDocument.createElement('div');
		this.layer.className = 'section-variants-native-frames';
		this.layer.setAttribute('aria-hidden', 'true');
		this.layer.contentEditable = 'false';
		view.dom.append(this.layer);
		const ownerWindow = view.dom.ownerDocument.defaultView!;
		this.observer = new ownerWindow.ResizeObserver(() => this.measure());
		this.observer.observe(view.contentDOM);
		view.scrollDOM.addEventListener('scroll', this.measure, { passive: true });
		this.measure();
	}

	update(_update: ViewUpdate): void { this.measure(); }

	destroy(): void {
		this.destroyed = true;
		this.observer.disconnect();
		this.view.scrollDOM.removeEventListener('scroll', this.measure);
		this.layer.remove();
	}

	private readonly measure = (): void => {
		if (this.destroyed) return;
		this.view.requestMeasure({
			key: this,
			read: (view) => {
				if (this.destroyed) return [];
				const ranges = this.ranges();
				if (!ranges.length) return [];
				const origin = view.dom.getBoundingClientRect();
				const headers = new Map(Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.section-variants-native-header')).map(el => [Number(el.dataset.blockFrom), el]));
				const ends = new Map(Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.section-variants-native-end')).map(el => [Number(el.dataset.blockFrom), el]));
				const contentRect = view.contentDOM.getBoundingClientRect();
				const contentStyle = view.dom.ownerDocument.defaultView!.getComputedStyle(view.contentDOM);
				return ranges.map(range => {
					const header = headers.get(range.from)?.getBoundingClientRect();
					const end = ends.get(range.from)?.getBoundingClientRect();
					// Source geometry remains available when either marker is virtualized.
					const top = header?.top ?? view.documentTop + view.lineBlockAt(range.from).top * view.scaleY;
					const bottom = end?.bottom ?? view.documentTop + view.lineBlockAt(range.to).bottom * view.scaleY;
					const left = header?.left ?? contentRect.left + parseFloat(contentStyle.paddingLeft) * view.scaleX;
					const width = header?.width ?? contentRect.width - (parseFloat(contentStyle.paddingLeft) + parseFloat(contentStyle.paddingRight)) * view.scaleX;
					const padding = 8 * view.scaleX;
					return {
						left: (left - origin.left - padding) / view.scaleX,
						top: (top - origin.top) / view.scaleY,
						width: (width + padding * 2) / view.scaleX,
						height: Math.max(header?.height ?? 0, bottom - top) / view.scaleY,
					};
				});
			},
			write: (rects) => {
				if (this.destroyed) return;
				while (this.layer.childElementCount > rects.length) this.layer.lastElementChild?.remove();
				rects.forEach((rect, index) => {
					let frame = this.layer.children[index] as HTMLElement | undefined;
					if (!frame) {
						frame = this.layer.ownerDocument.createElement('div');
						frame.className = 'section-variants-native-frame';
						this.layer.append(frame);
					}
					frame.style.left = `${rect.left}px`;
					frame.style.top = `${rect.top}px`;
					frame.style.width = `${rect.width}px`;
					frame.style.height = `${rect.height}px`;
				});
			},
		});
	};
}
