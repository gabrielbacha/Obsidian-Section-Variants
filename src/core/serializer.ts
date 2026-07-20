import { SAFE_SHORTHAND_LABEL } from './attributes';
import {
	ContainerAttributes,
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
	const normalized = labels.map((label) => label.toLocaleLowerCase());
	if (new Set(normalized).size !== normalized.length) {
		throw new Error('Labels must be unique, ignoring case.');
	}

	const outerLength = Math.max(4, (options.depth ?? 0) + 4);
	const innerLength = Math.max(3, outerLength - 1);
	const outerFence = ':'.repeat(outerLength);
	const innerFence = ':'.repeat(innerLength);
	const attributes = ['.variants'];
	if (options.id) attributes.push(`#${options.id}`);
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
		const opening = SAFE_SHORTHAND_LABEL.test(label)
			? `${innerFence} ${label}`
			: `${innerFence} {.variant label="${escapeAttribute(label)}"}`;
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

export function serializeContainerOpening(
	colonCount: number,
	attributes: ContainerAttributes,
): string {
	const values = ['.variants'];
	if (attributes.id) values.push(`#${attributes.id}`);
	if (attributes.view && attributes.view !== 'toggle') {
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
