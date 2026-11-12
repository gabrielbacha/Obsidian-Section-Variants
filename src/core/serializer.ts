import { SAFE_SHORTHAND_LABEL } from './attributes';
import {
	ContainerAttributes,
	normalizeLabel,
	SerializeOptions,
	SerializedBlock,
} from './types';

export function serializeVariantsBlock(
	options: SerializeOptions,
): SerializedBlock {
	const labels = options.labels.map((label) => label.trim());
	if (labels.length < 2 || labels.some((label) => !label)) {
		throw new Error('At least two nonempty labels are required.');
	}
	const normalized = labels.map(normalizeLabel);
	if (new Set(normalized).size !== normalized.length) {
		throw new Error('Labels must be unique, ignoring case.');
	}

	const outerLength = Math.max(4, (options.depth ?? 0) + 4);
	const innerLength = Math.max(3, outerLength - 1);
	const outerFence = ':'.repeat(outerLength);
	const innerFence = ':'.repeat(innerLength);
	const attributes = ['.variants'];
	if (options.id) attributes.push(`#${options.id}`);
	if (options.name) attributes.push(`name="${escapeAttribute(options.name)}"`);
	if (options.view && options.view !== 'toggle') {
		attributes.push(`view="${escapeAttribute(options.view)}"`);
	}
	if (options.defaultLabel && options.defaultLabel !== labels[0]) {
		attributes.push(`default="${escapeAttribute(options.defaultLabel)}"`);
	}
	if (options.responsive && options.responsive !== 'responsive') {
		attributes.push(`responsive="${escapeAttribute(options.responsive)}"`);
	}
	if (options.widths) {
		attributes.push(`widths="${escapeAttribute(options.widths)}"`);
	}
	if (options.minWidth) {
		attributes.push(`min-width="${escapeAttribute(options.minWidth)}"`);
	}

	const lines = [`${outerFence} {${attributes.join(' ')}}`, ''];
	let firstContentOffset = 0;
	for (const [index, label] of labels.entries()) {
		const opening = serializeVariantOpening(innerLength,label);
		lines.push(opening);
		if (index === 0) {
			firstContentOffset = lines.join('\n').length + 1;
		}
		lines.push('', '', innerFence, '');
	}
	lines.push(outerFence);
	return { markdown: lines.join('\n'), firstContentOffset };
}

export function escapeAttribute(value: string): string {
	return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

/** Change only named tokens; preserve aliases, classes, IDs and legacy values. */
export function patchOpeningAttribute(opening: string, key: string, value: string | undefined): string {
	const close = opening.lastIndexOf('}');
	if (close < 0) {
		if (value === undefined) return opening;
		const match = /^(\s*:{3,}\s+)(.*)$/u.exec(opening);
		if (!match) throw new Error('The opening fence is invalid.');
		return `${match[1]}{.${match[2]?.trim()} ${key}="${escapeAttribute(value)}"}`;
	}
	const pattern = key === 'id'
		? /(^|\s)#[^\s}]+/u
		: new RegExp(`(^|\\s)${key}=(?:"(?:\\\\.|[^"\\\\])*"|[^\\s}]+)`, 'u');
	const token = value === undefined ? '' : key === 'id' ? `#${value}` : `${key}="${escapeAttribute(value)}"`;
	if (pattern.test(opening)) return opening.replace(pattern, (_match, space: string) => `${space}${token}`);
	if (!token) return opening;
	return `${opening.slice(0, close).trimEnd()} ${token}${opening.slice(close)}`;
}

export function patchContainerOpening(opening: string, before: ContainerAttributes, after: ContainerAttributes): string {
	const keys: [keyof ContainerAttributes, string][] = [
		['id', 'id'], ['name', 'name'], ['view', 'view'], ['defaultLabel', 'default'],
		['widths', 'widths'], ['minWidth', 'min-width'], ['responsive', 'responsive'],
	];
	let result = opening;
	for (const [property, token] of keys) if (before[property] !== after[property]) {
		result = patchOpeningAttribute(result, token, after[property]);
	}
	return result;
}

export function patchVariantOpening(opening: string, label: string): string {
	if (opening.includes('{')) return patchOpeningAttribute(opening, 'label', label);
	const match = /^(\s*:{3,}\s+).*$/u.exec(opening);
	if (!match) throw new Error('The variant opening fence is invalid.');
	return SAFE_SHORTHAND_LABEL.test(label) ? `${match[1]}${label}`
		: `${match[1]}{.variant label="${escapeAttribute(label)}"}`;
}

export function serializeContainerOpening(
	colonCount: number,
	attributes: ContainerAttributes,
): string {
	const values = ['.variants'];
	if (attributes.id) values.push(`#${attributes.id}`);
	if (attributes.name) {
		values.push(`name="${escapeAttribute(attributes.name)}"`);
	}
	if (attributes.view) {
		values.push(`view="${attributes.view}"`);
	}
	if (attributes.defaultLabel) {
		values.push(`default="${escapeAttribute(attributes.defaultLabel)}"`);
	}
	if (attributes.widths) {
		values.push(`widths="${escapeAttribute(attributes.widths)}"`);
	}
	if (attributes.minWidth) {
		values.push(`min-width="${escapeAttribute(attributes.minWidth)}"`);
	}
	if (attributes.responsive && attributes.responsive !== 'responsive') {
		values.push(`responsive="${attributes.responsive}"`);
	}
	return `${':'.repeat(Math.max(3, colonCount))} {${values.join(' ')}}`;
}

export function defaultHtmlExportPath(markdownPath: string): string {
	return `${markdownPath.replace(/\.md$/iu, '')} variants.html`;
}

export function serializeVariantOpening(colonCount:number,label:string):string{
 const marker=':'.repeat(Math.max(3,colonCount)),value=label.trim();
 if(!value||/[\r\n]/u.test(value))throw new Error('Enter a label on one line.');
 return SAFE_SHORTHAND_LABEL.test(value)?`${marker} ${value}`:`${marker} {.variant label="${escapeAttribute(value)}"}`;
}
