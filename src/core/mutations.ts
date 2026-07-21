import { App, Editor, TFile } from 'obsidian';
import { SAFE_SHORTHAND_LABEL } from './attributes';
import { resolveCurrentBlock } from './block-resolution';
import { parseColumnRatios, serializeColumnRatios } from './column-ratios';
import { randomBytes } from './random';
import { escapeAttribute, serializeContainerOpening } from './serializer';
import { runStructuralTransaction } from './structural-transaction';
import {
	ContainerAttributes,
	normalizeLabel,
	ParsedNote,
	ResponsiveMode,
	VariantBlock,
} from './types';

export interface BlockIdentityMapping {
	before: VariantBlock;
	after: VariantBlock;
}

export interface SourceMutationResult {
	source: string;
}

export interface StableIdMutationResult
	extends BlockIdentityMapping,
		SourceMutationResult {
	id: string;
}

export interface RenameMutationResult extends SourceMutationResult {
	oldLabel: string;
	newLabel: string;
	acrossNote: boolean;
	mappings: BlockIdentityMapping[];
}

export interface VariantMutationResult
	extends BlockIdentityMapping,
		SourceMutationResult {
	label: string;
}

export async function addVariant(
	app: App,
	path: string,
	target: VariantBlock,
	label: string,
	parse: (source: string) => ParsedNote,
	editor?: Editor,
): Promise<VariantMutationResult> {
	const trimmed = validateNewLabel(label);
	const mapping = await processTarget(app, path, target, parse, (source, current) => {
		if (!current.valid || !current.closing) {
			throw new Error('Fix this variants block before adding a variant.');
		}
		if (
			current.variants.some(
				(variant) => variant.normalizedLabel === normalizeLabel(trimmed),
			)
		) {
			throw new Error(`Variant ${trimmed} already exists in this box.`);
		}
		const marker = ':'.repeat(Math.max(3, current.opening.colonCount - 1));
		const opening = serializeVariantOpening(marker, trimmed);
		const lineBreak = source.includes('\r\n') ? '\r\n' : '\n';
		const insertion = `${opening}${lineBreak}${lineBreak}${marker}${lineBreak}`;
		const edits = [
			{ from: current.closing.from, to: current.closing.from, text: insertion },
		];
		const ratios = current.attributes.widths
			? parseColumnRatios(current.attributes.widths, current.variants.length)
			: undefined;
		if (ratios) {
			edits.push({
				from: current.opening.from,
				to: current.opening.to,
				text: serializeContainerOpening(current.opening.colonCount, {
					...current.attributes,
					widths: serializeColumnRatios([...ratios, 1]),
				}),
			});
		}
		return applyEdits(source, edits);
	}, editor);
	return { ...mapping, label: trimmed };
}

export async function deleteVariant(
	app: App,
	path: string,
	target: VariantBlock,
	label: string,
	parse: (source: string) => ParsedNote,
	editor?: Editor,
): Promise<VariantMutationResult> {
	const normalized = normalizeLabel(label);
	const mapping = await processTarget(app, path, target, parse, (source, current) => {
		if (!current.valid || !current.closing) {
			throw new Error('Fix this variants block before deleting a variant.');
		}
		if (current.variants.length <= 1) {
			throw new Error('A variants box must retain at least one variant.');
		}
		const variant = current.variants.find(
			(candidate) => candidate.normalizedLabel === normalized,
		);
		if (!variant?.closing) {
			throw new Error(`Variant ${label} no longer exists in this box.`);
		}
		let end = variant.closing.to;
		if (source.slice(end, end + 2) === '\r\n') end += 2;
		else if (source.charCodeAt(end) === 10) end += 1;
		const edits = [{ from: variant.opening.from, to: end, text: '' }];
		const updatedAttributes = { ...current.attributes };
		let attributesChanged = false;
		if (
			current.attributes.defaultLabel &&
			normalizeLabel(current.attributes.defaultLabel) === normalized
		) {
			updatedAttributes.defaultLabel = undefined;
			attributesChanged = true;
		}
		const ratios = current.attributes.widths
			? parseColumnRatios(current.attributes.widths, current.variants.length)
			: undefined;
		if (ratios) {
			const variantIndex = current.variants.indexOf(variant);
			updatedAttributes.widths = serializeColumnRatios(
				ratios.filter((_ratio, index) => index !== variantIndex),
			);
			attributesChanged = true;
		}
		if (attributesChanged) {
			edits.push({
				from: current.opening.from,
				to: current.opening.to,
				text: serializeContainerOpening(
					current.opening.colonCount,
					updatedAttributes,
				),
			});
		}
		return applyEdits(source, edits);
	}, editor);
	return { ...mapping, label };
}

export async function addStableBlockId(
	app: App,
	path: string,
	target: VariantBlock,
	parse: (source: string) => ParsedNote,
	editor?: Editor,
): Promise<StableIdMutationResult> {
	let id = '';
	const mapping = await processTarget(app, path, target, parse, (source, current) => {
		if (!current.closing) throw new Error('Close the variants block before adding an ID.');
		// Generated here so it can be checked against IDs already in the note.
		id = `variants-${randomId(existingIds(source))}`;
		const insertion = current.closing.to;
		const lineBreak = source.slice(insertion, insertion + 2) === '\r\n'
			? '\r\n'
			: '\n';
		return `${source.slice(0, insertion)}${lineBreak}^${id}${source.slice(insertion)}`;
	}, editor);
	return { id, ...mapping };
}

export async function fixMissingClosers(
	app: App,
	path: string,
	target: VariantBlock,
	parse: (source: string) => ParsedNote,
	editor?: Editor,
): Promise<BlockIdentityMapping & SourceMutationResult> {
	return processTarget(app, path, target, parse, (source, current) => {
		if (current.range.to !== source.length || current.closing) {
			throw new Error('This block no longer has an unambiguous missing final closer.');
		}
		const missingVariant = current.variants.some((variant) => !variant.closing);
		const inner = ':'.repeat(Math.max(3, current.opening.colonCount - 1));
		const outer = ':'.repeat(current.opening.colonCount);
		const lineBreak = source.includes('\r\n') ? '\r\n' : '\n';
		const prefix = source.endsWith('\n') ? '' : lineBreak;
		return `${source}${prefix}${missingVariant ? `${inner}${lineBreak}` : ''}${outer}`;
	}, editor);
}

export async function updateBlockAttributes(
	app: App,
	path: string,
	target: VariantBlock,
	attributes: ContainerAttributes,
	parse: (source: string) => ParsedNote,
	editor?: Editor,
): Promise<BlockIdentityMapping & SourceMutationResult> {
	return processTarget(app, path, target, parse, (source, current) => {
		const opening = serializeContainerOpening(
			current.opening.colonCount,
			attributes,
		);
		return `${source.slice(0, current.opening.from)}${opening}${source.slice(current.opening.to)}`;
	}, editor);
}

export async function updateBlockAttributesPatch(
	app: App,
	path: string,
	target: VariantBlock,
	patch: Partial<ContainerAttributes>,
	parse: (source: string) => ParsedNote,
	editor?: Editor,
): Promise<BlockIdentityMapping & SourceMutationResult> {
	return processTarget(app, path, target, parse, (source, current) => {
		const opening = serializeContainerOpening(current.opening.colonCount, {
			...current.attributes,
			...patch,
		});
		return `${source.slice(0, current.opening.from)}${opening}${source.slice(current.opening.to)}`;
	}, editor);
}

export async function updateBlockResponsive(
	app: App,
	path: string,
	target: VariantBlock,
	responsive: ResponsiveMode,
	parse: (source: string) => ParsedNote,
	editor?: Editor,
): Promise<BlockIdentityMapping & SourceMutationResult> {
	return updateBlockAttributesPatch(
		app,
		path,
		target,
		{
			// Wrap is the syntax default, so keep the opening fence quiet.
			responsive: responsive === 'responsive' ? undefined : responsive,
		},
		parse,
		editor,
	);
}

export async function renameVariant(
	app: App,
	path: string,
	target: VariantBlock,
	oldLabel: string,
	newLabel: string,
	acrossNote: boolean,
	parse: (source: string) => ParsedNote,
	editor?: Editor,
): Promise<RenameMutationResult> {
	const trimmed = validateNewLabel(newLabel);
	let result: Omit<RenameMutationResult, 'source'> | undefined;
	const source = await processSource(app, path, editor, (source) => {
		const parsed = parse(source);
		const currentTarget = resolveCurrentBlock(target, parsed.blocks);
		if (!currentTarget) throw new Error('The variants block changed. Reopen rename and try again.');
		if (!currentTarget.valid) throw new Error('Fix this variants block before renaming its labels.');
		const normalizedOld = normalizeLabel(oldLabel);
		const blocks = acrossNote
			? parsed.blocks.filter((block) => block.valid)
			: [currentTarget];
		const edits: Array<{ from: number; to: number; text: string }> = [];
		const affectedIndices: number[] = [];

		for (const block of blocks) {
			const existing = block.variants.find(
				(variant) => variant.normalizedLabel === normalizeLabel(trimmed),
			);
			const renamed = block.variants.find(
				(variant) => variant.normalizedLabel === normalizedOld,
			);
			if (!renamed) continue;
			affectedIndices.push(parsed.blocks.indexOf(block));
			if (existing && existing !== renamed) {
				throw new Error(`Block on line ${block.opening.lineStart + 1} already has label ${trimmed}.`);
			}
			const marker = ':'.repeat(renamed.opening.colonCount);
			const opening = serializeVariantOpening(marker, trimmed);
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

		const changed = applyEdits(source, edits);
		const reparsed = parse(changed);
		const mappings = affectedIndices.map((index) => {
			const before = parsed.blocks[index];
			const after = reparsed.blocks[index];
			if (!before || !after) {
				throw new Error('The variants block could not be identified after renaming.');
			}
			return { before, after };
		});
		result = { oldLabel, newLabel: trimmed, acrossNote, mappings };
		return changed;
	});
	if (!result) throw new Error('The rename did not complete.');
	return { ...result, source };
}

function validateNewLabel(label: string): string {
	const trimmed = label.trim();
	if (!trimmed || /[\r\n]/u.test(trimmed)) {
		throw new Error('Labels must be nonempty and fit on one line.');
	}
	return trimmed;
}

function serializeVariantOpening(marker: string, label: string): string {
	return SAFE_SHORTHAND_LABEL.test(label)
		? `${marker} ${label}`
		: `${marker} {.variant label="${escapeAttribute(label)}"}`;
}

async function processTarget(
	app: App,
	path: string,
	target: VariantBlock,
	parse: (source: string) => ParsedNote,
	change: (source: string, current: VariantBlock) => string,
	editor?: Editor,
): Promise<BlockIdentityMapping & SourceMutationResult> {
	let mapping: BlockIdentityMapping | undefined;
	const source = await processSource(app, path, editor, (source) => {
		const parsed = parse(source);
		const current = resolveCurrentBlock(target, parsed.blocks);
		if (!current) throw new Error('The variants block changed. Try the action again.');
		const index = parsed.blocks.indexOf(current);
		const changed = change(source, current);
		const after = parse(changed).blocks[index];
		if (!after) throw new Error('The variants block could not be identified after the change.');
		mapping = { before: current, after };
		return changed;
	});
	if (!mapping) throw new Error('The variants block change did not complete.');
	return { ...mapping, source };
}

async function processSource(
	app: App,
	path: string,
	editor: Editor | undefined,
	change: (source: string) => string,
): Promise<string> {
	if (editor) {
		const source = editor.getValue();
		const changed = change(source);
		applyEditorChange(editor, source, changed);
		return changed;
	}
	const file = resolveFile(app, path);
	let changedSource: string | undefined;
	await app.vault.process(file, (source) => {
		changedSource = change(source);
		return changedSource;
	});
	if (changedSource === undefined) {
		throw new Error('The variants block change did not complete.');
	}
	return changedSource;
}

function applyEditorChange(editor: Editor, before: string, after: string): void {
	if (before === after) return;
	let prefix = 0;
	const sharedLength = Math.min(before.length, after.length);
	while (prefix < sharedLength && before[prefix] === after[prefix]) prefix += 1;
	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before[before.length - suffix - 1] === after[after.length - suffix - 1]
	) {
		suffix += 1;
	}
	runStructuralTransaction(() => {
		editor.transaction({
			changes: [
				{
					from: editor.offsetToPos(prefix),
					to: editor.offsetToPos(before.length - suffix),
					text: after.slice(prefix, after.length - suffix),
				},
			],
		});
	});
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
