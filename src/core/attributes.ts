import {
	ContainerAttributes,
	Diagnostic,
	ResponsiveMode,
	ViewMode,
} from './types';

export const SAFE_SHORTHAND_LABEL = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

interface AttributeBag {
	classes: string[];
	id?: string;
	values: Record<string, string>;
	diagnostics: Omit<Diagnostic, 'line' | 'from' | 'to'>[];
}

export interface OpeningDescription {
	kind: 'container' | 'variant' | 'other';
	attributes?: ContainerAttributes;
	label?: string;
	diagnostics: Omit<Diagnostic, 'line' | 'from' | 'to'>[];
}

const VIEW_MODES = new Set<ViewMode>(['toggle', 'columns', 'auto']);
const RESPONSIVE_MODES = new Set<ResponsiveMode>([
	'responsive',
	'stack',
	'scroll',
]);
const CONTAINER_KEYS = new Set([
	'name',
	'view',
	'default',
	'widths',
	'min-width',
	'responsive',
]);

export function describeOpening(
	raw: string,
	aliases: ReadonlySet<string>,
	directVariantChild: boolean,
): OpeningDescription {
	const text = raw.trim();
	if (!text.startsWith('{')) {
		if (aliases.has(text)) {
			return { kind: 'container', attributes: {}, diagnostics: [] };
		}
		if (directVariantChild) {
			const diagnostics: OpeningDescription['diagnostics'] = [];
			if (!SAFE_SHORTHAND_LABEL.test(text)) {
				diagnostics.push({
					code: 'unsafe-variant-shorthand',
					message:
						'Labels containing spaces or punctuation must use `{.variant label="…"}`.',
					severity: 'error',
				});
			}
			return { kind: 'variant', label: text, diagnostics };
		}
		return { kind: 'other', diagnostics: [] };
	}

	const bag = parseAttributeBag(text);
	if (bag.classes.some((className) => aliases.has(className))) {
		return describeContainer(bag);
	}
	if (bag.classes.includes('variant') && directVariantChild) {
		const label = bag.values.label?.trim() ?? '';
		const diagnostics = [...bag.diagnostics];
		if (!label) {
			diagnostics.push({
				code: 'missing-variant-label',
				message: 'Explicit variants require a nonempty `label` attribute.',
				severity: 'error',
			});
		}
		for (const key of Object.keys(bag.values)) {
			if (key !== 'label') {
				diagnostics.push({
					code: 'invalid-variant-attribute',
					message: `Unsupported variant attribute: ${key}.`,
					severity: 'error',
				});
			}
		}
		return { kind: 'variant', label, diagnostics };
	}
	return { kind: 'other', diagnostics: bag.diagnostics };
}

function describeContainer(bag: AttributeBag): OpeningDescription {
	const diagnostics = [...bag.diagnostics];
	const attributes: ContainerAttributes = {};
	if (bag.id) attributes.id = bag.id;
	if (bag.values.name) attributes.name = bag.values.name;

	for (const key of Object.keys(bag.values)) {
		if (!CONTAINER_KEYS.has(key)) {
			diagnostics.push({
				code: 'invalid-container-attribute',
				message: `Unsupported variants attribute: ${key}.`,
				severity: 'error',
			});
		}
	}

	const view = bag.values.view;
	if (view) {
		if (VIEW_MODES.has(view as ViewMode)) attributes.view = view as ViewMode;
		else diagnostics.push(invalidValue('view', view));
	}
	const responsive = bag.values.responsive;
	if (responsive) {
		if (RESPONSIVE_MODES.has(responsive as ResponsiveMode)) {
			attributes.responsive = responsive as ResponsiveMode;
		} else diagnostics.push(invalidValue('responsive', responsive));
	}
	if (bag.values.default) attributes.defaultLabel = bag.values.default;
	if (bag.values.widths) attributes.widths = bag.values.widths;
	if (bag.values['min-width']) attributes.minWidth = bag.values['min-width'];

	return { kind: 'container', attributes, diagnostics };
}

function invalidValue(
	key: string,
	value: string,
): Omit<Diagnostic, 'line' | 'from' | 'to'> {
	return {
		code: `invalid-${key}`,
		message: `Invalid ${key} value: ${value}.`,
		severity: 'error',
	};
}

function parseAttributeBag(raw: string): AttributeBag {
	const diagnostics: AttributeBag['diagnostics'] = [];
	if (!raw.endsWith('}')) {
		return {
			classes: [],
			values: {},
			diagnostics: [
				{
					code: 'unterminated-attributes',
					message: 'Attribute lists must open and close on the same line.',
					severity: 'error',
				},
			],
		};
	}

	const body = raw.slice(1, -1);
	const tokens = tokenizeAttributes(body, diagnostics);
	const bag: AttributeBag = { classes: [], values: {}, diagnostics };
	for (const token of tokens) {
		if (token.startsWith('.')) {
			bag.classes.push(token.slice(1));
			continue;
		}
		if (token.startsWith('#')) {
			if (bag.id) {
				diagnostics.push({
					code: 'duplicate-id-attribute',
					message: 'A variants block can contain only one ID.',
					severity: 'error',
				});
			}
			bag.id = token.slice(1);
			continue;
		}
		const separator = token.indexOf('=');
		if (separator < 1) {
			diagnostics.push({
				code: 'invalid-attribute-token',
				message: `Invalid attribute token: ${token}.`,
				severity: 'error',
			});
			continue;
		}
		const key = token.slice(0, separator);
		const value = unquote(token.slice(separator + 1), diagnostics);
		if (Object.prototype.hasOwnProperty.call(bag.values, key)) {
			diagnostics.push({
				code: 'duplicate-attribute',
				message: `Duplicate attribute: ${key}.`,
				severity: 'error',
			});
		}
		bag.values[key] = value;
	}
	return bag;
}

function tokenizeAttributes(
	text: string,
	diagnostics: AttributeBag['diagnostics'],
): string[] {
	const tokens: string[] = [];
	let current = '';
	let quote = false;
	let escaped = false;
	for (const character of text) {
		if (escaped) {
			current += `\\${character}`;
			escaped = false;
			continue;
		}
		if (character === '\\' && quote) {
			escaped = true;
			continue;
		}
		if (character === '"') {
			quote = !quote;
			current += character;
			continue;
		}
		if (/\s/u.test(character) && !quote) {
			if (current) tokens.push(current);
			current = '';
			continue;
		}
		current += character;
	}
	if (current) tokens.push(current);
	if (quote || escaped) {
		diagnostics.push({
			code: 'unterminated-attribute-value',
			message: 'Quoted attribute values must close on the opening line.',
			severity: 'error',
		});
	}
	return tokens;
}

function unquote(
	value: string,
	diagnostics: AttributeBag['diagnostics'],
): string {
	if (!value.startsWith('"')) return value;
	if (!value.endsWith('"') || value.length < 2) {
		diagnostics.push({
			code: 'unterminated-attribute-value',
			message: 'Quoted attribute values must close on the opening line.',
			severity: 'error',
		});
		return value.slice(1);
	}
	return value
		.slice(1, -1)
		.replace(/\\(["\\])/gu, '$1');
}
