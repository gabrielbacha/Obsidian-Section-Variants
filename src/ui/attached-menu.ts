import { setIcon } from 'obsidian';

export interface AttachedMenuItem {
	label: string;
	icon?: string;
	disabled?: boolean;
	warning?: boolean;
	onSelect?: () => void;
	children?: AttachedMenuItem[];
}

export interface ViewportSize {
	width: number;
	height: number;
}

export interface MenuSize {
	width: number;
	height: number;
}

export interface MenuPoint {
	x: number;
	y: number;
}

const activeMenus = new WeakMap<Document, () => void>();

export function rootMenuPosition(
	point: MenuPoint,
	menu: MenuSize,
	viewport: ViewportSize,
): MenuPoint {
	return {
		x: clamp(point.x, 0, Math.max(0, viewport.width - menu.width)),
		y: clamp(point.y, 0, Math.max(0, viewport.height - menu.height)),
	};
}

export function submenuPosition(
	anchor: Pick<DOMRect, 'left' | 'right' | 'top'>,
	menu: MenuSize,
	viewport: ViewportSize,
): MenuPoint {
	const openRight = anchor.right + menu.width <= viewport.width;
	return {
		x: openRight ? anchor.right : Math.max(0, anchor.left - menu.width),
		y: clamp(anchor.top, 0, Math.max(0, viewport.height - menu.height)),
	};
}

export function openAttachedMenu(
	event: MouseEvent,
	items: readonly AttachedMenuItem[],
): void {
	const origin = event.currentTarget as HTMLElement | null;
	const doc = origin?.ownerDocument ?? activeDocument;
	activeMenus.get(doc)?.();
	const ownerWindow = doc.defaultView;
	if (!ownerWindow) return;
	doc.querySelectorAll('.tooltip').forEach((tooltip) => tooltip.remove());
	const controller = new ownerWindow.AbortController();
	const root = createMenu(doc, items, controller, true);
	doc.body.append(root.element);
	const originRect = origin?.getBoundingClientRect();
	const openingPoint =
		event.detail === 0 && originRect
			? { x: originRect.right, y: originRect.top }
			: { x: event.clientX, y: event.clientY };
	positionElement(
		root.element,
		rootMenuPosition(
			openingPoint,
			measure(root.element),
			viewport(ownerWindow),
		),
	);
	const close = (restoreFocus = false): void => {
		controller.abort();
		root.closeSubmenu();
		root.element.remove();
		if (activeMenus.get(doc) === close) activeMenus.delete(doc);
		if (restoreFocus && origin?.isConnected) origin.focus();
	};
	activeMenus.set(doc, close);
	doc.addEventListener(
		'pointerdown',
		(pointerEvent) => {
			const target = pointerEvent.target;
			if (!(target instanceof ownerWindow.Node)) return;
			if (!root.element.contains(target) && !root.submenuContains(target)) close();
		},
		{ capture: true, signal: controller.signal },
	);
	doc.addEventListener(
		'keydown',
		(keyboardEvent) => {
			if (keyboardEvent.key !== 'Escape') return;
			keyboardEvent.preventDefault();
			if (!root.closeSubmenu(true)) close(true);
		},
		{ capture: true, signal: controller.signal },
	);
	doc.addEventListener(
		'focusin',
		(focusEvent) => {
			const target = focusEvent.target;
			if (!(target instanceof ownerWindow.Node)) return;
			if (!root.element.contains(target) && !root.submenuContains(target)) close();
		},
		{ capture: true, signal: controller.signal },
	);
	root.onSelect = close;
	root.focusFirst();
}

interface MenuHandle {
	element: HTMLElement;
	onSelect?: () => void;
	onCloseRequest?: () => void;
	focusFirst(): void;
	closeSubmenu(restoreFocus?: boolean): boolean;
	submenuContains(target: Node): boolean;
}

function createMenu(
	doc: Document,
	items: readonly AttachedMenuItem[],
	controller: AbortController,
	root: boolean,
): MenuHandle {
	const ownerWindow = doc.win as Window & {
		createDiv(): HTMLDivElement;
	};
	const element = ownerWindow.createDiv();
	element.className = `menu section-variants-context-menu${root ? '' : ' section-variants-context-submenu'}`;
	element.setAttribute('role', 'menu');
	element.setAttribute('aria-label', root ? 'Variant block actions' : 'Variants');
	const menuItems: HTMLElement[] = [];
	let submenu: MenuHandle | undefined;
	let submenuParent: HTMLElement | undefined;
	let handle: MenuHandle;

	const closeSubmenu = (restoreFocus = false): boolean => {
		if (!submenu) return false;
		submenu.element.remove();
		submenuParent?.setAttribute('aria-expanded', 'false');
		const parent = submenuParent;
		submenu = undefined;
		submenuParent = undefined;
		if (restoreFocus) parent?.focus();
		return true;
	};

	const openSubmenu = (
		menuItem: HTMLElement,
		children: readonly AttachedMenuItem[],
		focus = false,
	): void => {
		if (submenuParent === menuItem && submenu) {
			if (focus) submenu.focusFirst();
			return;
		}
		closeSubmenu();
		submenuParent = menuItem;
		menuItem.setAttribute('aria-expanded', 'true');
		submenu = createMenu(doc, children, controller, false);
		submenu.onSelect = () => handle.onSelect?.();
		submenu.onCloseRequest = () => closeSubmenu(true);
		doc.body.append(submenu.element);
		positionElement(
			submenu.element,
			submenuPosition(
				menuItem.getBoundingClientRect(),
				measure(submenu.element),
				viewport(doc.defaultView as Window),
			),
		);
		if (focus) submenu.focusFirst();
	};

	for (const item of items) {
		if (item.label === '-') {
			const separator = ownerWindow.createDiv();
			separator.className = 'menu-separator';
			separator.setAttribute('role', 'separator');
			element.append(separator);
			continue;
		}
		const menuItem = ownerWindow.createDiv();
		menuItem.className = 'menu-item section-variants-context-menu-item';
		menuItem.setAttribute('role', 'menuitem');
		menuItem.setAttribute('aria-disabled', String(item.disabled ?? false));
		menuItem.tabIndex = -1;
		menuItem.toggleClass('is-disabled', item.disabled ?? false);
		menuItem.toggleClass('is-warning', item.warning ?? false);
		if (item.icon) {
			const icon = menuItem.createSpan({ cls: 'menu-item-icon' });
			setIcon(icon, item.icon);
		}
		menuItem.createSpan({ cls: 'menu-item-title', text: item.label });
		if (item.children) {
			menuItem.setAttribute('aria-haspopup', 'menu');
			menuItem.setAttribute('aria-expanded', 'false');
			menuItem.createSpan({ cls: 'menu-item-icon section-variants-submenu-arrow', text: '›' });
			menuItem.addEventListener(
				'pointerenter',
				() => {
					if (isDisabled(menuItem)) closeSubmenu();
					else openSubmenu(menuItem, item.children ?? []);
				},
				{ signal: controller.signal },
			);
			menuItem.addEventListener(
				'focus',
				() => {
					if (!isDisabled(menuItem)) openSubmenu(menuItem, item.children ?? []);
				},
				{ signal: controller.signal },
			);
			menuItem.addEventListener(
				'click',
				() => {
					if (!isDisabled(menuItem)) openSubmenu(menuItem, item.children ?? [], true);
				},
				{ signal: controller.signal },
			);
		} else {
			menuItem.addEventListener(
				'pointerenter',
				() => closeSubmenu(),
				{ signal: controller.signal },
			);
			menuItem.addEventListener(
				'click',
				() => {
					if (isDisabled(menuItem)) return;
					item.onSelect?.();
					handle.onSelect?.();
				},
				{ signal: controller.signal },
			);
		}
		element.append(menuItem);
		menuItems.push(menuItem);
	}

	element.addEventListener(
		'keydown',
		(event) => {
			const current = doc.activeElement;
			const index = menuItems.findIndex((menuItem) => menuItem === current);
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				focusRelative(menuItems, index, event.key === 'ArrowDown' ? 1 : -1);
			} else if (event.key === 'Home' || event.key === 'End') {
				event.preventDefault();
				focusRelative(menuItems, event.key === 'Home' ? -1 : 0, 1);
			} else if (event.key === 'ArrowRight' && index >= 0) {
				const item = items.filter((candidate) => candidate.label !== '-')[index];
				if (item?.children) {
					event.preventDefault();
					openSubmenu(menuItems[index] as HTMLElement, item.children, true);
				}
			} else if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
				event.preventDefault();
				menuItems[index]?.click();
			} else if (event.key === 'ArrowLeft' && !root) {
				event.preventDefault();
				handle.onCloseRequest?.();
			}
		},
		{ signal: controller.signal },
	);

	handle = {
		element,
		focusFirst: () => focusRelative(menuItems, -1, 1),
		closeSubmenu,
		submenuContains: (target) =>
			submenu?.element.contains(target) === true ||
			submenu?.submenuContains(target) === true,
	};
	return handle;
}

function focusRelative(
	menuItems: readonly HTMLElement[],
	start: number,
	direction: 1 | -1,
): void {
	if (menuItems.length === 0) return;
	for (let offset = 1; offset <= menuItems.length; offset += 1) {
		const index =
			(start + direction * offset + menuItems.length) % menuItems.length;
		const menuItem = menuItems[index];
		if (menuItem && !isDisabled(menuItem)) {
			menuItem.focus();
			return;
		}
	}
}

function isDisabled(menuItem: HTMLElement): boolean {
	return menuItem.getAttribute('aria-disabled') === 'true';
}

function positionElement(element: HTMLElement, point: MenuPoint): void {
	element.style.left = `${point.x}px`;
	element.style.top = `${point.y}px`;
}

function measure(element: HTMLElement): MenuSize {
	return { width: element.offsetWidth, height: element.offsetHeight };
}

function viewport(ownerWindow: Window): ViewportSize {
	return { width: ownerWindow.innerWidth, height: ownerWindow.innerHeight };
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}
