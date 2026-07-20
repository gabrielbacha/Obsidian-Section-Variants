import { App, TFile } from 'obsidian';
import { SAFE_SHORTHAND_LABEL } from './attributes';
import { randomBytes } from './random';
import { escapeAttribute, serializeContainerOpening } from './serializer';
import {
	ContainerAttributes,
	normalizeLabel,
	ParsedNote,
	VariantBlock,
} from './types';

export async function addStableBlockId(
	app: App,
	path: string,
	target: VariantBlock,
	parse: (source: string) => ParsedNote,
): Promise<string> {
	let id = '';
	await processTarget(app, path, target, parse, (source, current) => {
		if (!current.closing) throw new Error('Close the variants block before adding an ID.');
		// Generated here so it can be checked against IDs already in the note.
		id = `variants-${randomId(existingIds(source))}`;
		const insertion = current.closing.to;
		return `${source.slice(0, insertion)}\n^${id}${source.slice(insertion)}`;
	});
	return id;
}

export async function fixMissingClosers(
	app: App,
	path: string,
	target: VariantBlock,
	parse: (source: string) => ParsedNote,
): Promise<void> {
	await processTarget(app, path, target, parse, (source, current) => {
		if (current.range.to !== source.length || current.closing) {
			throw new Error('This block no longer has an unambiguous missing final closer.');
		}
		const missingVariant = current.variants.some((variant) => !variant.closing);
		const inner = ':'.repeat(Math.max(3, current.opening.colonCount - 1));
		const outer = ':'.repeat(current.opening.colonCount);
		const prefix = source.endsWith('\n') ? '' : '\n';
		return `${source}${prefix}${missingVariant ? `${inner}\n` : ''}${outer}`;
	});
}

export async function updateBlockAttributes(
	app: App,
	path: string,
	target: VariantBlock,
	attributes: ContainerAttributes,
	parse: (source: string) => ParsedNote,
): Promise<void> {
	await processTarget(app, path, target, parse, (source, current) => {
		const opening = serializeContainerOpening(
			current.opening.colonCount,
			attributes,
		);
		return `${source.slice(0, current.opening.from)}${opening}${source.slice(current.opening.to)}`;
	});
}

export async function renameVariant(
	app: App,
	path: string,
	target: VariantBlock,
	oldLabel: string,
	newLabel: string,
	acrossNote: boolean,
	parse: (source: string) => ParsedNote,
): Promise<void> {
	const trimmed = newLabel.trim();
	if (!trimmed || /[\r\n]/u.test(trimmed)) {
		throw new Error('Labels must be nonempty and fit on one line.');
	}
	const file = resolveFile(app, path);
	await app.vault.process(file, (source) => {
		const parsed = parse(source);
		const currentTarget = findCurrentBlock(parsed, target);
		if (!currentTarget) throw new Error('The variants block changed. Reopen rename and try again.');
		const normalizedOld = normalizeLabel(oldLabel);
		const blocks = acrossNote ? parsed.blocks : [currentTarget];
		const edits: Array<{ from: number; to: number; text: string }> = [];

		for (const block of blocks) {
			const existing = block.variants.find(
				(variant) => variant.normalizedLabel === normalizeLabel(trimmed),
			);
			const renamed = block.variants.find(
				(variant) => variant.normalizedLabel === normalizedOld,
			);
			if (!renamed) continue;
			if (existing && existing !== renamed) {
				throw new Error(`Block on line ${block.opening.lineStart + 1} already has label ${trimmed}.`);
			}
			const marker = ':'.repeat(renamed.opening.colonCount);
			const opening = SAFE_SHORTHAND_LABEL.test(trimmed)
				? `${marker} ${trimmed}`
				: `${marker} {.variant label="${escapeAttribute(trimmed)}"}`;
			edits.push({ from: renamed.opening.from, to: renamed.opening.to, text: opening });
			if (
				block.attributes.defaultLabel &&
				normalizeLabel(block.attributes.defaultLabel) === normalizedOld
			) {
				edits.push({
					from: block.opening.from,
					to: block.opening.to,
					text: serializeContainerOpening(block.opening.colonCount, {
						...block.attributes,
						defaultLabel: trimmed,
					}),
				});
			}
		}

		return applyEdits(source, edits);
	});
}

async function processTarget(
	app: App,
	path: string,
	target: VariantBlock,
	parse: (source: string) => ParsedNote,
	change: (source: string, current: VariantBlock) => string,
): Promise<void> {
	const file = resolveFile(app, path);
	await app.vault.process(file, (source) => {
		const current = findCurrentBlock(parse(source), target);
		if (!current) throw new Error('The variants block changed. Try the action again.');
		return change(source, current);
	});
}

function findCurrentBlock(
	parsed: ParsedNote,
	target: VariantBlock,
): VariantBlock | undefined {
	return (
		parsed.blocks.find((block) => block.identityKey === target.identityKey) ??
		parsed.blocks.find(
			(block) =>
				block.fingerprint === target.fingerprint &&
				block.opening.text === target.opening.text,
		)
	);
}

function resolveFile(app: App, path: string): TFile {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new Error(`Note not found: ${path}`);
	return file;
}

function applyEdits(
	source: string,
	edits: Array<{ from: number; to: number; text: string }>,
): string {
	const deduplicated = new Map<string, { from: number; to: number; text: string }>();
	for (const edit of edits) deduplicated.set(`${edit.from}:${edit.to}`, edit);
	return [...deduplicated.values()]
		.sort((left, right) => right.from - left.from)
		.reduce(
			(result, edit) =>
				`${result.slice(0, edit.from)}${edit.text}${result.slice(edit.to)}`,
			source,
		);
}

/**
 * Identifiers already used in the note, covering both Obsidian block IDs
 * (`^id`) and Pandoc attribute IDs (`{#id}`), with the `variants-` prefix
 * stripped so they compare against generated suffixes.
 */
function existingIds(source: string): Set<string> {
	const found = new Set<string>();
	for (const match of source.matchAll(/(?:^\^|#)([\w-]+)/gmu)) {
		const id = match[1];
		if (!id) continue;
		found.add(id);
		if (id.startsWith('variants-')) found.add(id.slice('variants-'.length));
	}
	return found;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 6;

/**
 * Six base-36 characters, uniformly distributed.
 *
 * `byte.toString(36)` yields one or two characters depending on the value, so
 * slicing to a fixed length previously consumed a variable number of bytes and
 * skewed the distribution — shorter effective IDs, more collisions.
 */
function randomId(taken: ReadonlySet<string> = new Set()): string {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const bytes = randomBytes(ID_LENGTH);
		const id = [...bytes]
			.map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length] ?? '0')
			.join('');
		if (!taken.has(id)) return id;
	}
	throw new Error('Could not generate an unused block ID.');
}
